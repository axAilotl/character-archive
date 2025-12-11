import NodeCache from 'node-cache';
import {
    getCurrentMetrics,
    getTopTags,
    getLargestCards,
    getTokenDistribution,
    getCardsOverTime,
    getLatestSnapshot,
    getHistoricalSnapshots,
    computeDailySnapshot,
    getTopCardsPerPlatform,
    getTrendingTags
} from '../services/MetricsService.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('METRICS-CTRL');

// Cache metrics for 5 minutes (they don't change frequently)
const metricsCache = new NodeCache({
    stdTTL: 300,
    maxKeys: 100,
    useClones: false
});

class MetricsController {
    /**
     * GET /api/metrics/stats - Get current metrics (real-time or cached snapshot)
     */
    getStats = async (req, res) => {
        try {
            const realtime = req.query.realtime === 'true';
            const cacheKey = realtime ? 'metrics_realtime' : 'metrics_snapshot';

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            let metrics;
            if (realtime) {
                metrics = {
                    ...getCurrentMetrics(),
                    topTags: getTopTags(50),
                    largestCards: getLargestCards(10),
                    tokenDistribution: getTokenDistribution(),
                    source: 'realtime'
                };
            } else {
                const snapshot = getLatestSnapshot();
                metrics = {
                    ...snapshot.metrics,
                    topTags: snapshot.topTags,
                    largestCards: snapshot.largestCards,
                    tokenDistribution: snapshot.tokenDistribution,
                    computedAt: snapshot.computedAt,
                    source: 'snapshot'
                };
            }

            metricsCache.set(cacheKey, metrics);
            res.set('X-Cache', 'MISS');
            res.json(metrics);
        } catch (error) {
            log.error('Failed to get metrics stats', error);
            res.status(500).json({ error: 'Failed to get metrics' });
        }
    };

    /**
     * GET /api/metrics/top-tags - Get top tags with optional limit
     */
    getTopTags = async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const cacheKey = `top_tags_${limit}`;

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const tags = getTopTags(limit);
            metricsCache.set(cacheKey, tags);
            res.set('X-Cache', 'MISS');
            res.json(tags);
        } catch (error) {
            log.error('Failed to get top tags', error);
            res.status(500).json({ error: 'Failed to get top tags' });
        }
    };

    /**
     * GET /api/metrics/largest-cards - Get cards with highest token counts
     */
    getLargestCards = async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 20;
            const cacheKey = `largest_cards_${limit}`;

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const cards = getLargestCards(limit);
            metricsCache.set(cacheKey, cards);
            res.set('X-Cache', 'MISS');
            res.json(cards);
        } catch (error) {
            log.error('Failed to get largest cards', error);
            res.status(500).json({ error: 'Failed to get largest cards' });
        }
    };

    /**
     * GET /api/metrics/distribution - Get token count distribution
     */
    getDistribution = async (req, res) => {
        try {
            const cacheKey = 'token_distribution';

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const distribution = getTokenDistribution();
            metricsCache.set(cacheKey, distribution);
            res.set('X-Cache', 'MISS');
            res.json(distribution);
        } catch (error) {
            log.error('Failed to get token distribution', error);
            res.status(500).json({ error: 'Failed to get token distribution' });
        }
    };

    /**
     * GET /api/metrics/timeline - Get cards added over time
     */
    getTimeline = async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 30;
            const cacheKey = `timeline_${days}`;

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const timeline = getCardsOverTime(days);
            metricsCache.set(cacheKey, timeline);
            res.set('X-Cache', 'MISS');
            res.json(timeline);
        } catch (error) {
            log.error('Failed to get timeline', error);
            res.status(500).json({ error: 'Failed to get timeline' });
        }
    };

    /**
     * GET /api/metrics/history - Get historical snapshots for trends
     */
    getHistory = async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 30;
            const cacheKey = `history_${days}`;

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const history = getHistoricalSnapshots(days);
            metricsCache.set(cacheKey, history);
            res.set('X-Cache', 'MISS');
            res.json(history);
        } catch (error) {
            log.error('Failed to get historical metrics', error);
            res.status(500).json({ error: 'Failed to get historical metrics' });
        }
    };

    /**
     * POST /api/metrics/snapshot - Force compute a new daily snapshot
     */
    computeSnapshot = async (req, res) => {
        try {
            const snapshot = computeDailySnapshot();
            // Clear cache so next request gets fresh data
            metricsCache.flushAll();
            res.json({ success: true, snapshot });
        } catch (error) {
            log.error('Failed to compute snapshot', error);
            res.status(500).json({ error: 'Failed to compute snapshot' });
        }
    };

    /**
     * GET /api/metrics/trending-tags - Get trending tags (comparing to yesterday)
     */
    getTrendingTags = async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 20;
            const cacheKey = `trending_tags_${limit}`;

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const tags = getTrendingTags(limit);
            metricsCache.set(cacheKey, tags);
            res.set('X-Cache', 'MISS');
            res.json(tags);
        } catch (error) {
            log.error('Failed to get trending tags', error);
            res.status(500).json({ error: 'Failed to get trending tags' });
        }
    };

    /**
     * GET /api/metrics/top-cards-by-platform - Get top cards per platform
     */
    getTopCardsByPlatform = async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const cacheKey = `top_cards_platform_${limit}`;

            const cached = metricsCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const cards = getTopCardsPerPlatform(limit);
            metricsCache.set(cacheKey, cards);
            res.set('X-Cache', 'MISS');
            res.json(cards);
        } catch (error) {
            log.error('Failed to get top cards by platform', error);
            res.status(500).json({ error: 'Failed to get top cards by platform' });
        }
    };
}

export const metricsController = new MetricsController();
