
import { scanCardForUrls, cacheCardAssets, getCachedAssets, getGalleryAssets, clearCardAssets } from '../services/asset-cache.js';
import { appConfig } from '../services/ConfigState.js';

class AssetController {
    scanAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await scanCardForUrls(cardId);
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Scan assets error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    cacheAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await cacheCardAssets(cardId);
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Cache assets error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    getAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await getCachedAssets(cardId);
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Get assets error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    getGallery = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await getGalleryAssets(cardId);
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Get gallery error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    clearAssets = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const result = await clearCardAssets(cardId);
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Clear assets error:', error);
            res.status(500).json({ error: error.message });
        }
    };
}

export const assetController = new AssetController();
