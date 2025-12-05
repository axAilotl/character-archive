import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

const log = logger.scoped('DB:Conn');

let db = null;

/**
 * Initialize the database connection
 * @param {string} databaseFile - Path to the SQLite database file
 * @returns {Database} - The better-sqlite3 database instance
 */
export function createConnection(databaseFile) {
    if (db) {
        return db;
    }

    try {
        log.info(`Connecting to database at ${databaseFile}`);
        db = new Database(databaseFile);

        // Set optimized PRAGMAs for better-sqlite3
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
        db.pragma('cache_size = -64000');  // 64MB cache
        db.pragma('temp_store = MEMORY');
        db.pragma('mmap_size = 30000000000');  // 30GB memory map

        return db;
    } catch (error) {
        log.error('Failed to create database connection', error);
        throw error;
    }
}

/**
 * Get the existing database instance
 * @throws {Error} if database is not initialized
 * @returns {Database}
 */
export function getDbInstance() {
    if (!db) {
        throw new Error('Database not initialized. Call createConnection() first.');
    }
    return db;
}

/**
 * Close the database connection
 */
export function closeConnection() {
    if (db) {
        db.close();
        db = null;
        log.info('Database connection closed');
    }
}
