
import NodeCache from 'node-cache';
import { searchTags, getTagAliasesSnapshot, getRandomTags } from '../database.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('TAG');

const tagCache = new NodeCache({
    stdTTL: 3600,  // 1 hour (tags change rarely)
    maxKeys: 1000,
    useClones: false
});

class TagController {
    searchTags = async (req, res) => {
        try {
            const query = (req.query.q || '').toString();
            const limit = parseInt(req.query.limit) || 20;

            // Check tag cache
            const cacheKey = `tags_${query}_${limit}`;
            const cached = tagCache.get(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }

            const tags = searchTags(query, limit);
            tagCache.set(cacheKey, tags);
            res.set('X-Cache', 'MISS');
            res.json(tags);
        } catch (error) {
            log.error('Search tags error', error);
            res.status(500).json({ error: error.message });
        }
    };

    getTagAliases = (req, res) => {
        try {
            const aliases = getTagAliasesSnapshot();
            res.json({ aliases });
        } catch (error) {
            log.error('Fetch tag aliases error', error);
            res.status(500).json({ error: 'Failed to load tag aliases' });
        }
    };

    getRandomTags = async (req, res) => {
        try {
            const tags = getRandomTags();
            res.json(tags);
        } catch (error) {
            log.error('Reroll tags error', error);
            res.status(500).json({ error: error.message });
        }
    };
}

export const tagController = new TagController();
