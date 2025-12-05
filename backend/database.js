import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';
import { createConnection, getDbInstance, withTransaction } from './db/connection.js';
import { ensureSchema } from './db/schema.js';
import {
    getTagAliasesSnapshot,
    expandTagSearch,
    normalizeTagValue,
    splitTopicsToArray,
    replaceCardTagsForDatabase,
    replaceCardTags,
    rebuildCardTagsTable,
    shouldRebuildCardTags,
    searchTags,
    getRandomTags
} from './db/repositories/TagRepository.js';
import {
    upsertCard,
    getCards,
    getCardsByIdsOrdered,
    getAllLanguages,
    toggleFavorite,
    deleteCard,
    detectLanguage,
    backfillTokenCounts,
    LANGUAGE_MAPPING
} from './db/repositories/CardRepository.js';

const log = logger.scoped('DB');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_FILE = path.join(__dirname, '../cards.db');

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
 * Execute a function within a database transaction
 * Provides atomicity for multi-statement operations
 *
 * @param {Function} callback - Function to execute within transaction. Receives db as parameter.
 * @returns {*} - Result from callback function
 *
 * @example
 * withTransaction((db) => {
 *   db.prepare('INSERT INTO cards ...').run(data);
 *   db.prepare('INSERT INTO card_tags ...').run(tags);
 *   return cardId;
 * });
 */
export function withTransaction(callback) {
    const database = getDbInstance();

    // Use better-sqlite3 transaction API
    const transaction = database.transaction(callback);
    return transaction(database);
}

export {
    searchTags,
    getRandomTags,
    getTagAliasesSnapshot,
    replaceCardTags,
    expandTagSearch,
    splitTopicsToArray,
    normalizeTagValue,
    upsertCard,
    getCards,
    getCardsByIdsOrdered,
    getAllLanguages,
    toggleFavorite,
    deleteCard,
    detectLanguage,
    LANGUAGE_MAPPING
};