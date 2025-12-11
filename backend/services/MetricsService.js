import { getDatabase } from '../database.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('METRICS');

/**
 * Service for computing and storing metrics about the card archive
 */

/**
 * Get current real-time metrics (computed on-the-fly)
 */
export function getCurrentMetrics() {
    const db = getDatabase();

    // Total cards count
    const totalCards = db.prepare('SELECT COUNT(*) as count FROM cards').get().count;

    // Cards by source
    const sourceRows = db.prepare(`
        SELECT source, COUNT(*) as count
        FROM cards
        GROUP BY source
    `).all();
    const cardsBySource = {};
    for (const row of sourceRows) {
        cardsBySource[row.source || 'unknown'] = row.count;
    }

    // Token stats
    const tokenStats = db.prepare(`
        SELECT
            AVG(tokenCount) as avgTokenCount,
            SUM(tokenCount) as totalTokens,
            MIN(tokenCount) as minTokens,
            MAX(tokenCount) as maxTokens
        FROM cards
        WHERE tokenCount IS NOT NULL AND tokenCount > 0
    `).get();

    // Median token count (approximate using NTILE for performance)
    const medianRow = db.prepare(`
        SELECT tokenCount
        FROM cards
        WHERE tokenCount IS NOT NULL AND tokenCount > 0
        ORDER BY tokenCount
        LIMIT 1
        OFFSET (SELECT COUNT(*) / 2 FROM cards WHERE tokenCount IS NOT NULL AND tokenCount > 0)
    `).get();
    const medianTokenCount = medianRow?.tokenCount || 0;

    // Feature adoption
    const featureStats = db.prepare(`
        SELECT
            SUM(CASE WHEN hasLorebook = 1 OR hasEmbeddedLorebook = 1 OR hasLinkedLorebook = 1 THEN 1 ELSE 0 END) as cardsWithLorebook,
            SUM(CASE WHEN hasGallery = 1 THEN 1 ELSE 0 END) as cardsWithGallery,
            SUM(CASE WHEN hasExpressions = 1 THEN 1 ELSE 0 END) as cardsWithExpressions,
            SUM(CASE WHEN hasAlternateGreetings = 1 THEN 1 ELSE 0 END) as cardsWithAlternateGreetings,
            SUM(CASE WHEN hasSystemPrompt = 1 THEN 1 ELSE 0 END) as cardsWithSystemPrompt,
            SUM(CASE WHEN hasExampleDialogues = 1 THEN 1 ELSE 0 END) as cardsWithExampleDialogues
        FROM cards
    `).get();

    // Today's new cards
    const today = new Date().toISOString().split('T')[0];
    const newCardsToday = db.prepare(`
        SELECT COUNT(*) as count
        FROM cards
        WHERE DATE(firstDownloadedAt) = ?
    `).get(today).count;

    // This week's new cards
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const newCardsThisWeek = db.prepare(`
        SELECT COUNT(*) as count
        FROM cards
        WHERE DATE(firstDownloadedAt) >= ?
    `).get(weekAgo).count;

    // Favorited cards
    const favoritedCount = db.prepare(`
        SELECT COUNT(*) as count FROM cards WHERE favorited = 1
    `).get().count;

    return {
        totalCards,
        cardsBySource,
        avgTokenCount: Math.round(tokenStats?.avgTokenCount || 0),
        medianTokenCount,
        totalTokens: tokenStats?.totalTokens || 0,
        minTokens: tokenStats?.minTokens || 0,
        maxTokens: tokenStats?.maxTokens || 0,
        newCardsToday,
        newCardsThisWeek,
        favoritedCount,
        cardsWithLorebook: featureStats?.cardsWithLorebook || 0,
        cardsWithGallery: featureStats?.cardsWithGallery || 0,
        cardsWithExpressions: featureStats?.cardsWithExpressions || 0,
        cardsWithAlternateGreetings: featureStats?.cardsWithAlternateGreetings || 0,
        cardsWithSystemPrompt: featureStats?.cardsWithSystemPrompt || 0,
        cardsWithExampleDialogues: featureStats?.cardsWithExampleDialogues || 0
    };
}

/**
 * Get top tags with counts
 */
export function getTopTags(limit = 50) {
    const db = getDatabase();

    const rows = db.prepare(`
        SELECT tag, COUNT(*) as count
        FROM card_tags
        GROUP BY normalizedTag
        ORDER BY count DESC
        LIMIT ?
    `).all(limit);

    return rows.map(row => ({
        tag: row.tag,
        count: row.count
    }));
}

/**
 * Get largest cards by token count
 */
export function getLargestCards(limit = 20) {
    const db = getDatabase();

    return db.prepare(`
        SELECT id, name, author, tokenCount, source
        FROM cards
        WHERE tokenCount IS NOT NULL
        ORDER BY tokenCount DESC
        LIMIT ?
    `).all(limit);
}

/**
 * Get top cards per platform (by starCount/popularity)
 */
export function getTopCardsPerPlatform(limitPerPlatform = 5) {
    const db = getDatabase();
    const sources = ['chub', 'ct', 'risuai', 'wyvern'];
    const result = {};

    for (const source of sources) {
        const cards = db.prepare(`
            SELECT id, name, author, tokenCount, starCount, nChats, nMessages
            FROM cards
            WHERE source = ?
            ORDER BY COALESCE(starCount, 0) DESC, COALESCE(nChats, 0) DESC
            LIMIT ?
        `).all(source, limitPerPlatform);
        result[source] = cards;
    }

    return result;
}

/**
 * Get trending tags by comparing current counts to previous snapshot
 */
export function getTrendingTags(limit = 20) {
    const db = getDatabase();

    // Get yesterday's snapshot
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const previousSnapshot = db.prepare(`
        SELECT data FROM metrics_snapshots
        WHERE snapshot_date = ? AND metric_type = 'daily'
    `).get(yesterday);

    // Get current top tags
    const currentTags = getTopTags(100);

    if (!previousSnapshot) {
        // No previous data, return current tags with no change info
        return currentTags.slice(0, limit).map(tag => ({
            ...tag,
            change: 0,
            isNew: false
        }));
    }

    const previousData = JSON.parse(previousSnapshot.data);
    const previousTagMap = new Map(
        (previousData.topTags || []).map((t, i) => [t.tag, { count: t.count, rank: i }])
    );

    // Calculate changes
    const trending = currentTags.map((tag, currentRank) => {
        const prev = previousTagMap.get(tag.tag);
        if (!prev) {
            return { ...tag, change: tag.count, isNew: true, rankChange: 0 };
        }
        return {
            ...tag,
            change: tag.count - prev.count,
            isNew: false,
            rankChange: prev.rank - currentRank // positive = moved up
        };
    });

    // Sort by change (biggest gainers first)
    return trending
        .filter(t => t.change > 0 || t.isNew)
        .sort((a, b) => b.change - a.change)
        .slice(0, limit);
}

/**
 * Get token count distribution (for histogram)
 */
export function getTokenDistribution() {
    const db = getDatabase();

    // Define bucket ranges: 0-500, 500-1000, 1000-2000, 2000-5000, 5000-10000, 10000+
    const buckets = [
        { min: 0, max: 500, label: '0-500' },
        { min: 500, max: 1000, label: '500-1k' },
        { min: 1000, max: 2000, label: '1k-2k' },
        { min: 2000, max: 5000, label: '2k-5k' },
        { min: 5000, max: 10000, label: '5k-10k' },
        { min: 10000, max: 50000, label: '10k-50k' },
        { min: 50000, max: 999999999, label: '50k+' }
    ];

    const distribution = [];
    for (const bucket of buckets) {
        const row = db.prepare(`
            SELECT COUNT(*) as count
            FROM cards
            WHERE tokenCount >= ? AND tokenCount < ?
        `).get(bucket.min, bucket.max);

        distribution.push({
            label: bucket.label,
            count: row.count
        });
    }

    return distribution;
}

/**
 * Get cards added over time (for time series chart)
 */
export function getCardsOverTime(days = 30) {
    const db = getDatabase();

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const rows = db.prepare(`
        SELECT DATE(firstDownloadedAt) as date, COUNT(*) as count
        FROM cards
        WHERE DATE(firstDownloadedAt) >= ?
        GROUP BY DATE(firstDownloadedAt)
        ORDER BY date ASC
    `).all(startDate);

    return rows;
}

/**
 * Compute and store a daily snapshot
 */
export function computeDailySnapshot() {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];

    log.info(`Computing daily metrics snapshot for ${today}...`);

    const metrics = getCurrentMetrics();
    const topTags = getTopTags(100);
    const largestCards = getLargestCards(10);
    const tokenDistribution = getTokenDistribution();
    const topCardsPerPlatform = getTopCardsPerPlatform(5);

    const snapshotData = {
        metrics,
        topTags,
        largestCards,
        tokenDistribution,
        topCardsPerPlatform,
        computedAt: new Date().toISOString()
    };

    // Upsert the snapshot
    db.prepare(`
        INSERT INTO metrics_snapshots (snapshot_date, metric_type, data)
        VALUES (?, 'daily', ?)
        ON CONFLICT(snapshot_date, metric_type)
        DO UPDATE SET data = excluded.data, created_at = CURRENT_TIMESTAMP
    `).run(today, JSON.stringify(snapshotData));

    log.info(`Daily metrics snapshot saved for ${today}`);

    return snapshotData;
}

/**
 * Get the latest snapshot or compute if missing
 */
export function getLatestSnapshot() {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];

    // Try to get today's snapshot
    const row = db.prepare(`
        SELECT data FROM metrics_snapshots
        WHERE snapshot_date = ? AND metric_type = 'daily'
    `).get(today);

    if (row) {
        return JSON.parse(row.data);
    }

    // No snapshot for today, compute one
    return computeDailySnapshot();
}

/**
 * Get historical snapshots for trend analysis
 */
export function getHistoricalSnapshots(days = 30) {
    const db = getDatabase();

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const rows = db.prepare(`
        SELECT snapshot_date, data
        FROM metrics_snapshots
        WHERE metric_type = 'daily' AND snapshot_date >= ?
        ORDER BY snapshot_date ASC
    `).all(startDate);

    return rows.map(row => ({
        date: row.snapshot_date,
        ...JSON.parse(row.data)
    }));
}
