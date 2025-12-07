import NodeCache from 'node-cache';
import { logger } from '../utils/logger.js';

const log = logger.scoped('CACHE');

class CacheService {
    constructor() {
        this.cache = new NodeCache({
            stdTTL: 300,  // 5 minutes
            maxKeys: 100, // Limit memory usage
            useClones: false
        });
    }

    get(key) {
        return this.cache.get(key);
    }

    set(key, value) {
        this.cache.set(key, value);
    }

    flush() {
        log.info('Flushing cache');
        this.cache.flushAll();
    }
}

export const cacheService = new CacheService();
