
import { scanCardForUrls, cacheCardAssets, getCachedAssets, getGalleryAssets, clearCardAssets } from '../services/asset-cache.js';
import { appConfig } from '../services/ConfigState.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('ASSET');

class AssetController {
    scanAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await scanCardForUrls(cardId);
            res.json(result);
        } catch (error) {
            log.error('Scan assets error', error);
            res.status(500).json({ error: error.message });
        }
    };

    cacheAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await cacheCardAssets(cardId);
            res.json(result);
        } catch (error) {
            log.error('Cache assets error', error);
            res.status(500).json({ error: error.message });
        }
    };

    getAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await getCachedAssets(cardId);
            res.json(result);
        } catch (error) {
            log.error('Get assets error', error);
            res.status(500).json({ error: error.message });
        }
    };

    getGallery = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await getGalleryAssets(cardId);
            res.json(result);
        } catch (error) {
            log.error('Get gallery error', error);
            res.status(500).json({ error: error.message });
        }
    };

    clearAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await clearCardAssets(cardId);
            res.json(result);
        } catch (error) {
            log.error('Clear assets error', error);
            res.status(500).json({ error: error.message });
        }
    };
}

export const assetController = new AssetController();
