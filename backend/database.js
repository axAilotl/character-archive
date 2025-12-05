import Database from 'better-sqlite3';
import { franc } from 'franc';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveTokenCountsFromMetadata, TOKEN_COUNT_COLUMNS } from './utils/token-counts.js';
import { logger } from './utils/logger.js';
import { createConnection, getDbInstance, withTransaction } from './db/connection.js';
import { ensureSchema } from './db/schema.js';

const log = logger.scoped('DB');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fsp = fs.promises;
const STATIC_DIR = path.join(__dirname, '../static');

function getImageVersion(cardId) {
    if (!cardId) {
        return null;
    }
    try {
        const subfolder = cardId.substring(0, 2);
        const filePath = path.join(STATIC_DIR, subfolder, `${cardId}.png`);
        const stats = fs.statSync(filePath);
        return Math.floor(stats.mtimeMs || stats.mtime.getTime());
    } catch (error) {
        return null;
    }
}

function buildVersionedImagePath(cardId) {
    const basePath = `/static/${cardId.substring(0, 2)}/${cardId}.png`;
    const version = getImageVersion(cardId);
    if (!version) {
        return { path: basePath, version: null };
    }
    return { path: `${basePath}?v=${version}`, version };
}

const DATABASE_FILE = path.join(__dirname, '../cards.db');
const CARDS_PER_PAGE = 48;
const TAG_ALIASES_FILE = path.join(__dirname, '../tag-aliases.json');
const CARD_TAGS_TABLE_NAME = 'card_tags';

// Load tag aliases
let tagAliases = {};
let reverseAliasMap = {}; // Maps any variant to its alias group
try {
    tagAliases = JSON.parse(fs.readFileSync(TAG_ALIASES_FILE, 'utf8'));
    // Build reverse map for quick lookup
    for (const [canonical, variants] of Object.entries(tagAliases)) {
        for (const variant of variants) {
            reverseAliasMap[variant.toLowerCase()] = canonical;
        }
    }
    log.info(`Loaded tag aliases: ${Object.keys(tagAliases).length} groups`);
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

// Expand a tag search to include aliases and fuzzy matches
function expandTagSearch(searchTag) {
    const normalized = searchTag.toLowerCase().trim();
    const variants = new Set([searchTag]); // Always include original

    // Check if this tag has exact aliases
    const canonical = reverseAliasMap[normalized];
    if (canonical && tagAliases[canonical]) {
        // Add all variants from the alias group
        tagAliases[canonical].forEach(variant => variants.add(variant));
        log.debug(`TAG-ALIAS: "${searchTag}" -> exact match -> [${Array.from(variants).join(', ')}]`);
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
        log.debug(`TAG-FUZZY: "${searchTag}" -> fuzzy match (distance=${bestDistance}) -> [${Array.from(variants).join(', ')}]`);
    }

    return Array.from(variants);
}

// Language mapping
const LANGUAGE_MAPPING = {
    'eng': 'English', 'cat': 'Catalan', 'nld': 'Dutch', 'spa': 'Spanish',
    'fra': 'French', 'deu': 'German', 'ita': 'Italian', 'por': 'Portuguese',
    'cmn': 'Chinese', 'jpn': 'Japanese', 'kor': 'Korean', 'rus': 'Russian',
    'arb': 'Arabic', 'hin': 'Hindi', 'tgl': 'Tagalog', 'ind': 'Indonesian',
    'nor': 'Norwegian', 'hrv': 'Croatian', 'som': 'Somali', 'sqi': 'Albanian',
    'pol': 'Polish', 'est': 'Estonian', 'cym': 'Welsh', 'afr': 'Afrikaans',
    'swa': 'Swahili', 'slv': 'Slovenian', 'swe': 'Swedish', 'ron': 'Romanian',
    'tur': 'Turkish', 'dan': 'Danish', 'lit': 'Lithuanian', 'fin': 'Finnish',
    'vie': 'Vietnamese', 'hun': 'Hungarian', 'slk': 'Slovak', 'ces': 'Czech',
    'ben': 'Bengali', 'kan': 'Kannada', 'lav': 'Latvian', 'tam': 'Tamil',
    'ell': 'Greek', 'ukr': 'Ukrainian', 'bul': 'Bulgarian', 'fas': 'Persian',
    'mkd': 'Macedonian', 'heb': 'Hebrew', 'guj': 'Gujarati', 'mal': 'Malayalam',
    'tha': 'Thai', 'unknown': 'Unknown'
};

const preparedStatements = new Map();

function getStatement(name, sql) {
    if (!preparedStatements.has(name)) {
        preparedStatements.set(name, getDatabase().prepare(sql));
    }
    return preparedStatements.get(name);
}

function normalizeTagValue(tag) {
    if (typeof tag !== 'string') {
        return null;
    }
    const trimmed = tag.trim();
    return trimmed ? trimmed.toLowerCase() : null;
}

function splitTopicsToArray(topics) {
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

function replaceCardTagsForDatabase(databaseConn, cardId, topicsArray) {
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

// Optimized version for use within an existing transaction
function replaceCardTagsForDatabaseInTransaction(databaseConn, cardId, topicsArray, tableName = CARD_TAGS_TABLE_NAME) {
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

function replaceCardTags(cardId, topicsArray) {
    const databaseConn = getDatabase();
    replaceCardTagsForDatabase(databaseConn, cardId, topicsArray);
}

async function readMetadataFile(cardId) {
    const cardIdStr = String(cardId);
    const subfolder = path.join(STATIC_DIR, cardIdStr.substring(0, 2));
    const jsonPath = path.join(subfolder, `${cardIdStr}.json`);
    try {
        const raw = await fsp.readFile(jsonPath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function backfillTokenCounts(databaseConn) {
    if (!TOKEN_COUNT_COLUMNS.length) {
        return;
    }
    const nullChecks = TOKEN_COUNT_COLUMNS.map(column => `${column} IS NULL`).join(' OR ');
    const limit = 250;
    let processed = 0;

    try {
        const selectStmt = databaseConn.prepare(`SELECT id FROM cards WHERE source = 'chub' AND (${nullChecks}) LIMIT ?`);
        const updateStmt = databaseConn.prepare(`UPDATE cards
            SET tokenDescriptionCount = ?,
                tokenPersonalityCount = ?,
                tokenScenarioCount = ?,
                tokenMesExampleCount = ?,
                tokenFirstMessageCount = ?,
                tokenSystemPromptCount = ?,
                tokenPostHistoryCount = ?
            WHERE id = ?`);

        while (true) {
            const rows = selectStmt.all(limit);
            if (!rows.length) {
                break;
            }
            for (const row of rows) {
                const metadata = await readMetadataFile(row.id);
                if (!metadata) {
                    continue;
                }
                const counts = resolveTokenCountsFromMetadata(metadata);
                if (!counts) {
                    continue;
                }
                updateStmt.run(
                    counts.tokenDescriptionCount ?? 0,
                    counts.tokenPersonalityCount ?? 0,
                    counts.tokenScenarioCount ?? 0,
                    counts.tokenMesExampleCount ?? 0,
                    counts.tokenFirstMessageCount ?? 0,
                    counts.tokenSystemPromptCount ?? 0,
                    counts.tokenPostHistoryCount ?? 0,
                    row.id
                );
                processed += 1;
            }
        }
        if (processed > 0) {
            log.info(`Backfilled token counts for ${processed} card(s)`);
        }
    } catch (error) {
        log.warn('Failed to backfill token counts', error);
    }
}

function rebuildCardTagsTable(databaseConn) {
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

function shouldRebuildCardTags(databaseConn) {
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

/**
 * Initialize database connection
 */
export function initDatabase(options = {}) {
    const {
        skipTagRebuild = false,
        skipTokenBackfill = false,
        skipSchemaMigrations = false
    } = options;

    try {
        const db = createConnection(DATABASE_FILE);

        if (!skipSchemaMigrations) {
            ensureSchema(db);
        }

        if (!skipTokenBackfill) {
            backfillTokenCounts(db).catch(error => {
                log.warn('Deferred token count backfill failed', error);
            });
        }

        if (!skipTagRebuild) {
            const { needsRebuild, reason } = shouldRebuildCardTags(db);
            if (needsRebuild) {
                log.info(`Rebuilding card_tags table (${reason})`);
                rebuildCardTagsTable(db);
            } else {
                log.info('card_tags table already in sync, skipping rebuild');
            }
        }

        log.info('Database initialized');
        return db;
    } catch (error) {
        log.error('Database init failed', error);
        throw error;
    }
}

/**
 * Get database instance
 */
export function getDatabase() {
    return getDbInstance();
}


/**
 * Detect language of text
 */
export function detectLanguage(text, threshold = 0.8, minLength = 20) {
    try {
        if (!text || text.trim().length < minLength) {
            return 'unknown';
        }
        
        const langCode = franc(text, { minLength: 10 });
        return langCode === 'und' ? 'unknown' : langCode;
    } catch (error) {
        log.error('Language detection failed', error);
        return 'unknown';
    }
}

/**
 * Update or insert card in database
 */
export function upsertCard(metadata) {
    const database = getDatabase();

    const topicsArray = Array.isArray(metadata.topics)
        ? metadata.topics
        : splitTopicsToArray(metadata.topics || '');
    const topics = Array.isArray(metadata.topics) ? metadata.topics.join(',') : metadata.topics || '';
    const author = metadata.fullPath ? metadata.fullPath.split('/')[0] : '';
    const combinedText = `${metadata.description || ''} ${metadata.tagline || ''}`;
    const language = detectLanguage(combinedText);

    let favoritedValue = 0;
    let firstDownloadedAt = null;

    // Check if firstDownloadedAt column exists (for migration safety)
    const columns = database.prepare(`PRAGMA table_info(cards)`).all();
    const hasFirstDownloadedAt = columns.some(col => col.name === 'firstDownloadedAt');

    const selectFields = hasFirstDownloadedAt
        ? 'SELECT favorited, firstDownloadedAt FROM cards WHERE id = ?'
        : 'SELECT favorited FROM cards WHERE id = ?';

    const existing = database.prepare(selectFields).get(metadata.id);
    if (existing) {
        favoritedValue = existing.favorited ? 1 : 0;
        if (hasFirstDownloadedAt && existing.firstDownloadedAt) {
            firstDownloadedAt = existing.firstDownloadedAt; // Preserve existing download timestamp
        } else {
            // Column exists but no value, or column doesn't exist yet - set timestamp
            firstDownloadedAt = new Date().toISOString();
        }
    } else {
        // New card - set firstDownloadedAt to now
        firstDownloadedAt = new Date().toISOString();

        if (typeof metadata.favorited !== 'undefined') {
            favoritedValue = metadata.favorited ? 1 : 0;
        } else if (typeof metadata.is_favorite !== 'undefined') {
            favoritedValue = metadata.is_favorite ? 1 : 0;
        }
    }

    const baseColumns = [
        'id', 'author', 'name', 'tagline', 'description', 'topics', 'tokenCount',
        'tokenDescriptionCount', 'tokenPersonalityCount', 'tokenScenarioCount',
        'tokenMesExampleCount', 'tokenFirstMessageCount', 'tokenSystemPromptCount',
        'tokenPostHistoryCount', 'lastModified', 'createdAt'
    ];

    if (hasFirstDownloadedAt) {
        baseColumns.push('firstDownloadedAt');
    }

    baseColumns.push(
        'nChats', 'nMessages', 'n_favorites',
        'starCount', 'ratingsEnabled', 'rating', 'ratingCount', 'ratings',
        'fullPath', 'favorited', 'language', 'visibility',
        'hasAlternateGreetings', 'hasLorebook', 'hasEmbeddedLorebook', 'hasLinkedLorebook',
        'hasExampleDialogues', 'hasSystemPrompt', 'hasGallery', 'hasEmbeddedImages', 'hasExpressions', 'isFuzzed',
        'source', 'sourceId', 'sourcePath', 'sourceUrl'
    );

    const columnsClause = baseColumns.join(', ');
    const placeholdersClause = baseColumns.map(() => '?').join(', ');

    const sql = `INSERT OR REPLACE INTO cards (${columnsClause}) VALUES (${placeholdersClause})`;
    
    const computedSourceUrl = resolveSourceUrlValue({
        source: metadata.source || 'chub',
        sourceUrl: metadata.sourceUrl,
        sourcePath: metadata.sourcePath || metadata.fullPath || '',
        sourceId: metadata.sourceId || String(metadata.id || ''),
        fullPath: metadata.fullPath || ''
    });

    // Build parameters array conditionally
    const params = [
        metadata.id,
        author,
        metadata.name || '',
        metadata.tagline || '',
        metadata.description || '',
        topics,
        metadata.nTokens || 0,
        metadata.tokenDescriptionCount ?? null,
        metadata.tokenPersonalityCount ?? null,
        metadata.tokenScenarioCount ?? null,
        metadata.tokenMesExampleCount ?? null,
        metadata.tokenFirstMessageCount ?? null,
        metadata.tokenSystemPromptCount ?? null,
        metadata.tokenPostHistoryCount ?? null,
        (metadata.lastActivityAt || '1970-01-01T00:00:00').replace('T', ' ').split('.')[0],
        (metadata.createdAt || '1970-01-01T00:00:00').replace('T', ' ').split('.')[0]
    ];

    // Add firstDownloadedAt only if column exists
    if (hasFirstDownloadedAt) {
        params.push(firstDownloadedAt);
    }

    // Continue with rest of parameters
    params.push(
        metadata.nChats || 0,
        metadata.nMessages || 0,
        metadata.n_favorites || 0,
        metadata.starCount || 0,
        metadata.ratingsEnabled ? 1 : 0,
        metadata.rating || 0.0,
        metadata.ratingCount || 0,
        metadata.ratings || '{}',
        metadata.fullPath || '',
        favoritedValue,
        language,
        metadata.visibility || 'unknown',
        metadata.hasAlternateGreetings ? 1 : 0,
        metadata.hasLorebook ? 1 : 0,
        metadata.hasEmbeddedLorebook ? 1 : 0,
        metadata.hasLinkedLorebook ? 1 : 0,
        metadata.hasExampleDialogues ? 1 : 0,
        metadata.hasSystemPrompt ? 1 : 0,
        metadata.hasGallery ? 1 : 0,
        metadata.hasEmbeddedImages ? 1 : 0,
        metadata.hasExpressions ? 1 : 0,
        metadata.isFuzzed ? 1 : 0,
        metadata.source || 'chub',
        metadata.sourceId || String(metadata.id),
        metadata.sourcePath || metadata.fullPath || '',
        computedSourceUrl
    );

    log.debug(`Upserting card ${metadata.id}: stars=${metadata.starCount}, favs=${metadata.n_favorites}, rating=${metadata.rating}, lastModified=${params[14]}`);

    // Use transaction to ensure atomicity of card insert + tags update
    withTransaction((db) => {
        db.prepare(sql).run(...params);
        replaceCardTagsForDatabase(db, metadata.id, topicsArray);
    });

    log.debug(`Card ${metadata.id} upserted successfully`);
}

/**
 * Get all cards with pagination and filtering
 */
export function getCards(options = {}) {
    const {
        page = 1,
        limit = CARDS_PER_PAGE,
        query = '',
        includeQuery = '',
        excludeQuery = '',
        searchType = 'full',
        tagMatchMode = 'or',
        sort = 'new',
        source = 'all',
        language = null,
        favoriteFilter = null,
        hasAlternateGreetings = false,
        hasLorebook = false,
        hasEmbeddedLorebook = false,
        hasLinkedLorebook = false,
        hasExampleDialogues = false,
        hasSystemPrompt = false,
        hasGallery = false,
        hasEmbeddedImages = false,
        hasExpressions = false,
        allowedIds = null,
        followedOnly = false,
        followedCreators = [],
        minTokens = null
    } = options;
    
    const database = getDatabase();
    const offset = (page - 1) * limit;
    const allowedIdList = Array.isArray(allowedIds)
        ? allowedIds
            .map(id => Number.isInteger(id) ? id : Number.parseInt(id, 10))
            .filter(id => Number.isInteger(id))
        : null;

    if (Array.isArray(allowedIds) && (!allowedIdList || allowedIdList.length === 0)) {
        return {
            cards: [],
            count: 0,
            page,
            totalPages: 0
        };
    }
    
    let sql = 'SELECT * FROM cards WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as count FROM cards WHERE 1=1';
    const params = [];
    const countParams = [];
    
    // Add filters based on search type and query
    const parseTagList = (value) => value
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);

    const includeFilterTags = includeQuery
        ? parseTagList(includeQuery)
        : [];
    const includeSearchTags = (searchType === 'tag' && query)
        ? parseTagList(query)
        : [];
    const includeTags = Array.from(new Set([...includeFilterTags, ...includeSearchTags]));
    const excludeTags = excludeQuery
        ? parseTagList(excludeQuery)
        : [];

    const buildVariantGroups = (list) => list
        .map(tag => {
            const variants = new Set();
            const addVariant = (value) => {
                const normalized = normalizeTagValue(value);
                if (normalized) {
                    variants.add(normalized);
                }
            };
            addVariant(tag);
            expandTagSearch(tag).forEach(addVariant);
            return Array.from(variants);
        })
        .filter(group => group.length > 0);

    const includeGroups = buildVariantGroups(includeTags);
    const excludeGroups = buildVariantGroups(excludeTags);

    const appendClause = (clause, clauseParams = []) => {
        if (!clause) {
            return;
        }
        sql += ` AND ${clause}`;
        countSql += ` AND ${clause}`;
        if (clauseParams.length > 0) {
            params.push(...clauseParams);
            countParams.push(...clauseParams);
        }
    };

    const buildExistsClause = (variants, negate = false) => {
        if (!variants || variants.length === 0) {
            return { clause: '', params: [] };
        }
        const placeholders = variants.map(() => '?').join(', ');
        const operator = negate ? 'NOT EXISTS' : 'EXISTS';
        const clause = `${operator} (SELECT 1 FROM ${CARD_TAGS_TABLE_NAME} ct WHERE ct.cardId = cards.id AND ct.normalizedTag IN (${placeholders}))`;
        return { clause, params: variants };
    };

    if (includeGroups.length > 0) {
        if (tagMatchMode === 'and') {
            includeGroups.forEach(group => {
                const { clause, params: clauseParams } = buildExistsClause(group, false);
                appendClause(clause, clauseParams);
            });
        } else {
            const flattened = Array.from(new Set(includeGroups.flat()));
            const { clause, params: clauseParams } = buildExistsClause(flattened, false);
            appendClause(clause, clauseParams);
        }
    }

    if (excludeGroups.length > 0) {
        excludeGroups.forEach(group => {
            const { clause, params: clauseParams } = buildExistsClause(group, true);
            appendClause(clause, clauseParams);
        });
    }

    if (query && searchType !== 'tag') {
        if (searchType === 'title') {
            sql += ' AND (name LIKE ?)';
            countSql += ' AND (name LIKE ?)';
            params.push(`%${query}%`);
            countParams.push(`%${query}%`);
        } else if (searchType === 'author') {
            sql += ' AND (author LIKE ?)';
            countSql += ' AND (author LIKE ?)';
            params.push(`%${query}%`);
            countParams.push(`%${query}%`);
        } else { // full text search
            sql += ' AND (name LIKE ? OR description LIKE ? OR tagline LIKE ? OR topics LIKE ? OR author LIKE ?)';
            countSql += ' AND (name LIKE ? OR description LIKE ? OR tagline LIKE ? OR topics LIKE ? OR author LIKE ?)';
            const searchPattern = `%${query}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
            countParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
        }
    }

    
    if (typeof minTokens === 'number' && Number.isFinite(minTokens) && minTokens > 0) {
        sql += ' AND tokenCount >= ?';
        countSql += ' AND tokenCount >= ?';
        params.push(minTokens);
        countParams.push(minTokens);
    }

    if (language) {
        sql += ' AND language = ?';
        countSql += ' AND language = ?';
        params.push(language);
        countParams.push(language);
    }

    if (source && source !== 'all') {
        sql += ' AND source = ?';
        countSql += ' AND source = ?';
        params.push(source);
        countParams.push(source);
    }
    
    if (favoriteFilter === 'fav') {
        sql += ' AND favorited = 1';
        countSql += ' AND favorited = 1';
    } else if (favoriteFilter === 'not_fav') {
        sql += ' AND (favorited IS NULL OR favorited = 0)';
        countSql += ' AND (favorited IS NULL OR favorited = 0)';
    } else if (favoriteFilter === 'shadowban') {
        sql += ' AND visibility = "shadowban"';
        countSql += ' AND visibility = "shadowban"';
    } else if (favoriteFilter === 'deleted') {
        sql += ' AND visibility = "deleted"';
        countSql += ' AND visibility = "deleted"';
    }

    if (hasAlternateGreetings) {
        sql += ' AND hasAlternateGreetings = 1';
        countSql += ' AND hasAlternateGreetings = 1';
    }

    if (hasLorebook) {
        sql += ' AND hasLorebook = 1';
        countSql += ' AND hasLorebook = 1';
    }

    if (hasEmbeddedLorebook) {
        sql += ' AND hasEmbeddedLorebook = 1';
        countSql += ' AND hasEmbeddedLorebook = 1';
    }

    if (hasLinkedLorebook) {
        sql += ' AND hasLinkedLorebook = 1';
        countSql += ' AND hasLinkedLorebook = 1';
    }

    if (hasExampleDialogues) {
        sql += ' AND hasExampleDialogues = 1';
        countSql += ' AND hasExampleDialogues = 1';
    }

    if (hasSystemPrompt) {
        sql += ' AND hasSystemPrompt = 1';
        countSql += ' AND hasSystemPrompt = 1';
    }

    if (hasGallery) {
        sql += ' AND hasGallery = 1';
        countSql += ' AND hasGallery = 1';
    }

    if (hasEmbeddedImages) {
        sql += ' AND hasEmbeddedImages = 1';
        countSql += ' AND hasEmbeddedImages = 1';
    }

    if (hasExpressions) {
        sql += ' AND hasExpressions = 1';
        countSql += ' AND hasExpressions = 1';
    }

    if (followedOnly) {
        const authorList = Array.isArray(followedCreators)
            ? followedCreators
                .map(name => (name || '').trim())
                .filter(Boolean)
            : [];
        if (authorList.length === 0) {
            return {
                cards: [],
                count: 0,
                page,
                totalPages: 0
            };
        }
        const placeholders = authorList.map(() => '?').join(', ');
        sql += ` AND LOWER(author) IN (${placeholders})`;
        countSql += ` AND LOWER(author) IN (${placeholders})`;
        authorList.forEach(author => {
            params.push(author.toLowerCase());
            countParams.push(author.toLowerCase());
        });
    }

    if (allowedIdList && allowedIdList.length > 0) {
        const placeholders = allowedIdList.map(() => '?').join(', ');
        sql += ` AND id IN (${placeholders})`;
        countSql += ` AND id IN (${placeholders})`;
        params.push(...allowedIdList);
        countParams.push(...allowedIdList);
    }
    
    // Advanced sorting expressions
    const lastActivityExpr = `COALESCE(lastModified, createdAt, '1970-01-01 00:00:00')`;
    const activityAgeExpr = `MAX(1.0, julianday('now') - julianday(${lastActivityExpr}))`;
    const freshnessBonusExpr = `CASE
            WHEN julianday('now') - julianday(${lastActivityExpr}) <= 3 THEN 25.0
            WHEN julianday('now') - julianday(${lastActivityExpr}) <= 7 THEN 15.0
            WHEN julianday('now') - julianday(${lastActivityExpr}) <= 14 THEN 8.0
            ELSE 0.0
        END`;
    const ratingContributionExpr = `(MAX(0.0, CAST(COALESCE(rating, 0) AS REAL) - 3.0) * CAST(COALESCE(ratingCount, 0) AS REAL) * 0.2)`;
    const engagementScoreExpr = `((CAST(COALESCE(nChats, 0) AS REAL) * 1.5) + (CAST(COALESCE(nMessages, 0) AS REAL) * 0.1) + (CAST(COALESCE(n_favorites, 0) AS REAL) * 2.0) + (CAST(COALESCE(starCount, 0) AS REAL) * 0.5) + ${ratingContributionExpr} + ${freshnessBonusExpr})`;

    // Add sorting
    const sortMap = {
        'new': 'lastModified DESC',
        'old': 'lastModified ASC',
        'create_new': 'createdAt DESC',
        'create_old': 'createdAt ASC',
        'recently_added': 'firstDownloadedAt DESC',
        'oldest_added': 'firstDownloadedAt ASC',
        'tokens_desc': 'tokenCount DESC',
        'tokens_asc': 'tokenCount ASC',
        'most_stars_desc': 'starCount DESC',
        'most_stars_asc': 'starCount ASC',
        'most_favs_desc': 'n_favorites DESC',
        'most_favs_asc': 'n_favorites ASC',
        'most_msgs_desc': 'nMessages DESC',
        'most_msgs_asc': 'nMessages ASC',
        'most_chats_desc': 'nChats DESC',
        'most_chats_asc': 'nChats ASC',
        'overall_rating_desc': '(CAST(COALESCE(starCount, 0) AS REAL) * 1.0 + CAST(COALESCE(n_favorites, 0) AS REAL) * 2.0) DESC, id DESC',
        'overall_rating_asc': '(CAST(COALESCE(starCount, 0) AS REAL) * 1.0 + CAST(COALESCE(n_favorites, 0) AS REAL) * 2.0) ASC, id ASC',
        'trending_desc': '((CAST(COALESCE(starCount, 0) AS REAL) * 1.0 + CAST(COALESCE(n_favorites, 0) AS REAL) * 2.0) / MAX(1.0, julianday(\'now\') - julianday(createdAt))) DESC, id DESC',
        'trending_asc': '((CAST(COALESCE(starCount, 0) AS REAL) * 1.0 + CAST(COALESCE(n_favorites, 0) AS REAL) * 2.0) / MAX(1.0, julianday(\'now\') - julianday(createdAt))) ASC, id ASC',
        'engagement_desc': `${engagementScoreExpr} DESC, id DESC`,
        'engagement_asc': `${engagementScoreExpr} ASC, id ASC`,
        'fresh_engagement_desc': `(${engagementScoreExpr} / ${activityAgeExpr}) DESC, id DESC`,
        'fresh_engagement_asc': `(${engagementScoreExpr} / ${activityAgeExpr}) ASC, id ASC`
    };

    const orderBy = sortMap[sort] || sortMap.new;
    log.debug(`Sort param: "${sort}", Using ORDER BY: ${orderBy}`);
    sql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    // Execute synchronously with better-sqlite3
    const countResult = database.prepare(countSql).all(...countParams);
    const cards = database.prepare(sql).all(...params);

    if (sort === 'overall_rating_desc' && cards.length > 0) {
        log.debug('Top 3 results for overall_rating_desc:');
        cards.slice(0, 3).forEach(card => {
            const score = (card.starCount || 0) * 1.0 + (card.n_favorites || 0) * 2.0;
            log.debug(`  ${card.name}: stars=${card.starCount}, favs=${card.n_favorites}, score=${score}`);
        });
    }

    return {
        cards: cards.map(rowToCard),
        count: countResult[0].count,
        page,
        totalPages: Math.ceil(countResult[0].count / limit)
    };
}

/**
 * Convert database row to card object
 */
function sanitizeCtPath(value = '') {
    if (!value || typeof value !== 'string') {
        return '';
    }
    return value.trim().replace(/^\/+/, '');
}

function buildCtSourceUrl(pathPart = '', idPart = '') {
    const sanitizedPath = sanitizeCtPath(pathPart);
    if (sanitizedPath) {
        return `https://character-tavern.com/character/${sanitizedPath}`;
    }
    const fallbackId = sanitizeCtPath(idPart);
    if (fallbackId) {
        return `https://character-tavern.com/character/${fallbackId}`;
    }
    return '';
}

function resolveSourceUrlValue({ source, sourceUrl, sourcePath, sourceId, fullPath } = {}) {
    if (source === 'ct') {
        const ctUrl = buildCtSourceUrl(sourcePath || fullPath || '', sourceId || '');
        if (ctUrl) {
            return ctUrl;
        }
        if (sourceUrl && sourceUrl.includes('character-tavern.com')) {
            return sourceUrl;
        }
    }

    if (sourceUrl) {
        return sourceUrl;
    }
    if (fullPath) {
        return `https://chub.ai/characters/${fullPath}`;
    }
    return '';
}

function rowToCard(row) {
    const cardId = String(row.id);
    // Deduplicate topics while preserving order
    const topicsArray = row.topics ? row.topics.split(',') : [];
    const uniqueTopics = [...new Set(topicsArray)];

    const versionedImage = buildVersionedImagePath(cardId);

    return {
        id: cardId,
        id_prefix: cardId.substring(0, 2),
        author: row.author || '',
        name: row.name || '',
        tagline: row.tagline || '',
        description: row.description || '',
        topics: uniqueTopics,
        imagePath: versionedImage.path,
        imageVersion: versionedImage.version,
        tokenCount: row.tokenCount || 0,
        lastModified: row.lastModified ? row.lastModified.split(' ')[0] : 'Unknown',
        createdAt: row.createdAt ? row.createdAt.split(' ')[0] : 'Unknown',
        nChats: row.nChats || 0,
        nMessages: row.nMessages || 0,
        n_favorites: row.n_favorites || 0,
        starCount: row.starCount || 0,
        rating: row.rating || 0,
        ratingCount: row.ratingCount || 0,
        ratings: row.ratings || '{}',
        fullPath: row.fullPath || '',
        language: row.language || 'unknown',
        favorited: row.favorited || 0,
        visibility: row.visibility || 'unknown',
        hasAlternateGreetings: !!row.hasAlternateGreetings,
        hasLorebook: !!row.hasLorebook,
        hasEmbeddedLorebook: !!row.hasEmbeddedLorebook,
        hasLinkedLorebook: !!row.hasLinkedLorebook,
        hasExampleDialogues: !!row.hasExampleDialogues,
        hasSystemPrompt: !!row.hasSystemPrompt,
        hasGallery: !!row.hasGallery,
        hasEmbeddedImages: !!row.hasEmbeddedImages,
        hasExpressions: !!row.hasExpressions,
        source: row.source || 'chub',
        sourceId: row.sourceId || '',
        sourcePath: row.sourcePath || row.fullPath || '',
        sourceUrl: resolveSourceUrlValue({
            source: row.source || 'chub',
            sourceUrl: row.sourceUrl,
            sourcePath: row.sourcePath || row.fullPath || '',
            sourceId: row.sourceId || '',
            fullPath: row.fullPath || ''
        })
    };
}

export function getCardsByIdsOrdered(idList = []) {
    if (!Array.isArray(idList) || idList.length === 0) {
        return [];
    }
    const normalized = idList
        .map(id => String(id).trim())
        .filter(id => id && /^\d+$/.test(id));

    if (normalized.length === 0) {
        return [];
    }

    const uniqueIds = Array.from(new Set(normalized));
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const database = getDatabase();
    const rows = database.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...uniqueIds);
    const rowMap = new Map();
    rows.forEach(row => {
        rowMap.set(String(row.id), row);
    });

    return normalized
        .map(id => rowMap.get(id))
        .filter(Boolean)
        .map(rowToCard);
}

/**
 * Get all unique languages
 */
export function getAllLanguages() {
    const database = getDatabase();
    const rows = database.prepare('SELECT DISTINCT language FROM cards WHERE language IS NOT NULL').all();

    const result = {};
    rows.forEach(row => {
        result[row.language] = LANGUAGE_MAPPING[row.language] || row.language;
    });

    return result;
}

/**
 * Search tags by partial match
 */
export function searchTags(query = '', limit = 20) {
    const database = getDatabase();
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

/**
 * Get random tags
 */
export function getRandomTags(count = 10) {
    const database = getDatabase();
    const rows = database.prepare(
        `SELECT tag FROM ${CARD_TAGS_TABLE_NAME}
         GROUP BY normalizedTag
         ORDER BY RANDOM()
         LIMIT ?`
    ).all(count);
    return rows.map(row => row.tag);
}

/**
 * Toggle favorite status
 */
export function toggleFavorite(cardId) {
    const database = getDatabase();
    const card = database.prepare('SELECT favorited FROM cards WHERE id = ?').get(cardId);

    if (!card) {
        return { success: false, message: 'Card not found' };
    }

    const newStatus = card.favorited ? 0 : 1;
    database.prepare('UPDATE cards SET favorited = ? WHERE id = ?').run(newStatus, cardId);

    return { success: true, favorited: newStatus };
}

/**
 * Delete card from database
 */
export function deleteCard(cardId) {
    const database = getDatabase();
    const result = database.prepare('DELETE FROM cards WHERE id = ?').run(cardId);

    return { success: result.changes > 0, removed: result.changes > 0 };
}

export {
    LANGUAGE_MAPPING
};

export default {
    initDatabase,
    getDatabase,
    upsertCard,
    getCards,
    getCardsByIdsOrdered,
    getAllLanguages,
    searchTags,
    getRandomTags,
    toggleFavorite,
    deleteCard,
    LANGUAGE_MAPPING,
    getTagAliasesSnapshot
};
