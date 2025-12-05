import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import { getDbInstance } from '../connection.js';

const log = logger.scoped('Repo:Tags');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to tag-aliases.json (root/tag-aliases.json)
const TAG_ALIASES_FILE = path.join(__dirname, '../../../tag-aliases.json');
const CARD_TAGS_TABLE_NAME = 'card_tags';

// Load tag aliases
let tagAliases = {};
let reverseAliasMap = {}; // Maps any variant to its alias group

try {
    if (fs.existsSync(TAG_ALIASES_FILE)) {
        tagAliases = JSON.parse(fs.readFileSync(TAG_ALIASES_FILE, 'utf8'));
        // Build reverse map for quick lookup
        for (const [canonical, variants] of Object.entries(tagAliases)) {
            for (const variant of variants) {
                reverseAliasMap[variant.toLowerCase()] = canonical;
            }
        }
        log.info(`Loaded tag aliases: ${Object.keys(tagAliases).length} groups`);
    } else {
        log.warn(`Tag aliases file not found at ${TAG_ALIASES_FILE}`);
    }
} catch (err) {
    log.warn('Failed to load tag aliases', err);
}

export function getTagAliasesSnapshot() {
    try {
        return JSON.parse(JSON.stringify(tagAliases));
    } catch (err) {
        log.warn('Failed to clone tag aliases', err);
        return {};
    }
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

export function expandTagSearch(searchTag) {
    const normalized = searchTag.toLowerCase().trim();
    const variants = new Set([searchTag]); // Always include original

    // Check if this tag has exact aliases
    const canonical = reverseAliasMap[normalized];
    if (canonical && tagAliases[canonical]) {
        // Add all variants from the alias group
        tagAliases[canonical].forEach(variant => variants.add(variant));
        return Array.from(variants);
    }

    // If no exact match, try fuzzy matching against canonical tag names
    const len = normalized.length;
    const maxDistance = len >= 6 ? 2 : len >= 4 ? 1 : 0; // Avoid over-matching ultra short tags
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const canonicalTag of Object.keys(tagAliases)) {
        const distance = levenshteinDistance(normalized, canonicalTag.toLowerCase());
        if (distance <= maxDistance && distance < bestDistance) {
            bestDistance = distance;
            bestMatch = canonicalTag;
        }
    }

    // Also check against all variants in the reverse map
    if (bestMatch === null) {
        for (const [variant, canon] of Object.entries(reverseAliasMap)) {
            const distance = levenshteinDistance(normalized, variant.toLowerCase());
            if (distance <= maxDistance && distance < bestDistance) {
                bestDistance = distance;
                bestMatch = canon;
            }
        }
    }

    if (bestMatch && tagAliases[bestMatch]) {
        // Found a fuzzy match, expand to that group
        tagAliases[bestMatch].forEach(variant => variants.add(variant));
    }

    return Array.from(variants);
}

export function normalizeTagValue(tag) {
    if (typeof tag !== 'string') {
        return null;
    }
    const trimmed = tag.trim();
    return trimmed ? trimmed.toLowerCase() : null;
}

export function splitTopicsToArray(topics) {
    if (!topics) {
        return [];
    }
    if (Array.isArray(topics)) {
        return topics.map(tag => tag).filter(Boolean);
    }
    return topics
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
}

export function replaceCardTagsForDatabase(databaseConn, cardId, topicsArray) {
    if (!databaseConn) {
        throw new Error('Database connection is required to update card tags');
    }

    databaseConn.prepare(`DELETE FROM ${CARD_TAGS_TABLE_NAME} WHERE cardId = ?`).run(cardId);
    if (!Array.isArray(topicsArray) || topicsArray.length === 0) {
        return;
    }

    const uniqueTags = new Map();
    topicsArray.forEach(rawTag => {
        if (typeof rawTag !== 'string') {
            return;
        }
        const trimmed = rawTag.trim();
        if (!trimmed) {
            return;
        }
        const normalized = normalizeTagValue(trimmed);
        if (!normalized) {
            return;
        }
        if (!uniqueTags.has(normalized)) {
            uniqueTags.set(normalized, trimmed);
        }
    });

    if (uniqueTags.size === 0) {
        return;
    }

    const insertStmt = databaseConn.prepare(`INSERT OR REPLACE INTO ${CARD_TAGS_TABLE_NAME} (cardId, tag, normalizedTag) VALUES (?, ?, ?)`);
    for (const [normalized, display] of uniqueTags.entries()) {
        insertStmt.run(cardId, display, normalized);
    }
}

export function replaceCardTagsForDatabaseInTransaction(databaseConn, cardId, topicsArray, tableName = CARD_TAGS_TABLE_NAME) {
    if (!databaseConn) {
        throw new Error('Database connection is required to update card tags');
    }

    // Delete is fast within transaction
    databaseConn.prepare(`DELETE FROM ${tableName} WHERE cardId = ?`).run(cardId);

    if (!Array.isArray(topicsArray) || topicsArray.length === 0) {
        return;
    }

    // Build unique tags map
    const uniqueTags = new Map();
    topicsArray.forEach(rawTag => {
        if (typeof rawTag !== 'string') {
            return;
        }
        const trimmed = rawTag.trim();
        if (!trimmed) {
            return;
        }
        const normalized = normalizeTagValue(trimmed);
        if (!normalized) {
            return;
        }
        if (!uniqueTags.has(normalized)) {
            uniqueTags.set(normalized, trimmed);
        }
    });

    if (uniqueTags.size === 0) {
        return;
    }

    // Batch insert using multi-value INSERT (SQLite supports this)
    const tags = Array.from(uniqueTags.entries());
    const chunkSize = 100; // Insert up to 100 tags per statement

    for (let i = 0; i < tags.length; i += chunkSize) {
        const chunk = tags.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
        const values = [];

        chunk.forEach(([normalized, display]) => {
            values.push(cardId, display, normalized);
        });

        const sql = `INSERT OR REPLACE INTO ${tableName} (cardId, tag, normalizedTag) VALUES ${placeholders}`;
        databaseConn.prepare(sql).run(...values);
    }
}

export function replaceCardTags(cardId, topicsArray) {
    const databaseConn = getDbInstance();
    replaceCardTagsForDatabase(databaseConn, cardId, topicsArray);
}

export function shouldRebuildCardTags(databaseConn) {
    try {
        const taggedCardsRow = databaseConn.prepare("SELECT COUNT(*) AS count FROM cards WHERE topics IS NOT NULL AND TRIM(topics) <> ''").get();
        const tagsRow = databaseConn.prepare(`SELECT COUNT(DISTINCT cardId) AS count FROM ${CARD_TAGS_TABLE_NAME}`).get();
        const totalTaggedCards = taggedCardsRow?.count || 0;
        const indexedCards = tagsRow?.count || 0;

        if (totalTaggedCards === 0) {
            return { needsRebuild: false, reason: 'no tagged cards' };
        }

        if (indexedCards === 0) {
            return { needsRebuild: true, reason: 'no indexed tags' };
        }

        if (indexedCards !== totalTaggedCards) {
            return { needsRebuild: true, reason: `indexed ${indexedCards} vs tagged ${totalTaggedCards}` };
        }

        return { needsRebuild: false, reason: 'counts match' };
    } catch (error) {
        log.warn('card_tags consistency check failed', error);
        return { needsRebuild: true, reason: 'consistency check failed' };
    }
}

export function rebuildCardTagsTable(databaseConn) {
    const taggedCardsRow = databaseConn.prepare("SELECT COUNT(*) AS count FROM cards WHERE topics IS NOT NULL AND TRIM(topics) <> ''").get();
    const tagsRow = databaseConn.prepare(`SELECT COUNT(DISTINCT cardId) AS count FROM ${CARD_TAGS_TABLE_NAME}`).get();
    const totalTaggedCards = taggedCardsRow?.count || 0;
    const indexedCards = tagsRow?.count || 0;

    if (totalTaggedCards === 0) {
        return;
    }

    if (indexedCards >= totalTaggedCards && indexedCards !== 0) {
        return;
    }

    const tempTableName = `${CARD_TAGS_TABLE_NAME}_new`;
    log.info('Rebuilding card_tags table for tag search consistency (staged swap)');

    databaseConn.prepare(`DROP TABLE IF EXISTS ${tempTableName}`).run();
    databaseConn.prepare(`
        CREATE TEMP TABLE ${tempTableName} (
            cardId INTEGER NOT NULL,
            tag TEXT NOT NULL,
            normalizedTag TEXT NOT NULL,
            PRIMARY KEY(cardId, normalizedTag)
        )
    `).run();

    const rows = databaseConn.prepare("SELECT id, topics FROM cards WHERE topics IS NOT NULL AND TRIM(topics) <> ''").all();
    const BATCH_SIZE = 500;
    const totalRows = rows.length;

    log.info(`Processing ${totalRows} cards in batches of ${BATCH_SIZE}`);

    try {
        for (let i = 0; i < totalRows; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const batchEnd = Math.min(i + BATCH_SIZE, totalRows);

            const transaction = databaseConn.transaction((batch) => {
                for (const row of batch) {
                    const tags = splitTopicsToArray(row.topics);
                    replaceCardTagsForDatabaseInTransaction(databaseConn, row.id, tags, tempTableName);
                }
            });

            try {
                transaction(batch);
                log.info(`Processed ${batchEnd}/${totalRows} cards (${Math.round(batchEnd/totalRows*100)}%)`);
            } catch (error) {
                log.error(`Failed to process batch ${i}-${batchEnd}`, error);
                throw error;
            }
        }

        log.info('Swapping rebuilt card_tags snapshot into place');
        const swapTransaction = databaseConn.transaction(() => {
            databaseConn.prepare(`DELETE FROM ${CARD_TAGS_TABLE_NAME}`).run();
            databaseConn.prepare(`
                INSERT INTO ${CARD_TAGS_TABLE_NAME} (cardId, tag, normalizedTag)
                SELECT cardId, tag, normalizedTag FROM ${tempTableName}
            `).run();
        });

        try {
            swapTransaction();
        } catch (error) {
            throw error;
        }

        log.info('card_tags rebuild complete');
    } finally {
        try {
            databaseConn.prepare(`DROP TABLE IF EXISTS ${tempTableName}`).run();
        } catch (cleanupError) {
            log.warn('Failed to drop temporary card_tags table', cleanupError);
        }
    }
}

export function searchTags(query = '', limit = 20) {
    const database = getDbInstance();
    const searchLower = (query || '').toLowerCase().trim();

    if (!searchLower) {
        const rows = database.prepare(
            `SELECT tag FROM ${CARD_TAGS_TABLE_NAME} GROUP BY normalizedTag ORDER BY tag COLLATE NOCASE LIMIT ?`
        ).all(limit);
        return rows.map(row => row.tag);
    }

    const likeParam = `%${searchLower}%`;
    const startsWithParam = `${searchLower}%`;
    let rows = database.prepare(
        `SELECT tag FROM ${CARD_TAGS_TABLE_NAME}
         WHERE normalizedTag LIKE ?
         GROUP BY normalizedTag
         ORDER BY CASE WHEN normalizedTag LIKE ? THEN 0 ELSE 1 END, normalizedTag
         LIMIT ?`
    ).all(likeParam, startsWithParam, limit);

    if (rows.length === 0) {
        const fallbackRows = database.prepare('SELECT topics FROM cards WHERE topics IS NOT NULL').all();
        const allTags = new Set();
        fallbackRows.forEach(row => {
            if (row.topics) {
                row.topics.split(',').forEach(tag => {
                    const trimmed = tag.trim();
                    if (trimmed) {
                        allTags.add(trimmed);
                    }
                });
            }
        });

        rows = Array.from(allTags)
            .filter(tag => tag.toLowerCase().includes(searchLower))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .slice(0, limit)
            .map(tag => ({ tag }));
    }

    return rows.map(row => row.tag);
}

export function getRandomTags(count = 10) {
    const database = getDbInstance();
    const rows = database.prepare(
        `SELECT tag FROM ${CARD_TAGS_TABLE_NAME}
         GROUP BY normalizedTag
         ORDER BY RANDOM()
         LIMIT ?`
    ).all(count);
    return rows.map(row => row.tag);
}
