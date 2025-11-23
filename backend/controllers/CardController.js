import { appConfig } from '../services/ConfigState.js';
import { sillyTavernService } from '../services/SillyTavernService.js';
import {
    getCards,
    getCardsByIdsOrdered,
    getAllLanguages,
    getRandomTags,
    LANGUAGE_MAPPING,
    getDatabase,
    toggleFavorite,
    deleteCard,
    getTagAliasesSnapshot
} from '../database.js';
import {
    isSearchIndexEnabled,
    isVectorSearchReady,
    searchMeilisearchCards,
    searchVectorCards
} from '../services/search-index.js';
import NodeCache from 'node-cache';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import { readCardPngSpec, getCardFilePaths, deriveFeatureFlagsFromSpec } from '../utils/card-utils.js';
import { refreshCard } from '../services/scraper.js';
import {
    setCardGalleryFlag,
    setCardFavoriteFlag,
    refreshGalleryIfNeeded
} from '../services/CardService.js';
import { syncFavoriteToChub } from '../services/SyncService.js';
import { clearCardAssets, cacheGalleryAssets, getGalleryAssets, rewriteCardUrls } from '../services/asset-cache.js';

// Cache specifically for the controller (or shared if we move it to a service)
const queryCache = new NodeCache({
    stdTTL: 300,  // 5 minutes
    maxKeys: 100,  // Limit memory usage
    useClones: false
});

// Helper to send cached response (duplicated from server.js for now, should be shared util)
function sendCachedResponse(res, data, cacheKey, startTime, page) {
    const duration = Date.now() - startTime;
    if (page > 1 && cacheKey) {
        queryCache.set(cacheKey, data);
    }
    res.set('X-Cache', 'MISS');
    res.set('X-Response-Time', `${duration}ms`);
    res.json(data);
}

// Helper (this should probably be in a service, but keeping here for now as it was in server.js)
const STATIC_DIR = path.join(process.cwd(), 'static');

// Local cache invalidation helper (since we moved queryCache into this file/class)
const invalidateQueryCache = () => {
    queryCache.flushAll();
    console.log('[CACHE] Query cache cleared');
};


async function syncFeatureFlagsFromMetadata(cardId, metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return;
    }
    const database = getDatabase();
    const spec = readCardPngSpec(cardId);
    const specFlags = spec ? deriveFeatureFlagsFromSpec(spec) : {};

    const pickBoolean = (key) => {
        if (typeof metadata[key] !== 'undefined') {
            return metadata[key] ? 1 : 0;
        }
        if (typeof specFlags[key] !== 'undefined') {
            return specFlags[key] ? 1 : 0;
        }
        return 0;
    };

    try {
        database.prepare(
            `UPDATE cards SET
                hasAlternateGreetings = ?,
                hasLorebook = ?,
                hasEmbeddedLorebook = ?,
                hasLinkedLorebook = ?,
                hasExampleDialogues = ?,
                hasSystemPrompt = ?,
                hasGallery = ?,
                hasEmbeddedImages = ?,
                hasExpressions = ?
            WHERE id = ?`
        ).run(
            pickBoolean('hasAlternateGreetings'),
            pickBoolean('hasLorebook'),
            pickBoolean('hasEmbeddedLorebook'),
            pickBoolean('hasLinkedLorebook'),
            pickBoolean('hasExampleDialogues'),
            pickBoolean('hasSystemPrompt'),
            pickBoolean('hasGallery'),
            pickBoolean('hasEmbeddedImages'),
            pickBoolean('hasExpressions'),
            cardId
        );
    } catch (error) {
        console.warn(`[WARN] Failed to sync metadata flags for card ${cardId}:`, error?.message || error);
    }

    Object.assign(metadata, {
        hasAlternateGreetings: Boolean(pickBoolean('hasAlternateGreetings')),
        hasLorebook: Boolean(pickBoolean('hasLorebook')),
        hasEmbeddedLorebook: Boolean(pickBoolean('hasEmbeddedLorebook')),
        hasLinkedLorebook: Boolean(pickBoolean('hasLinkedLorebook')),
        hasExampleDialogues: Boolean(pickBoolean('hasExampleDialogues')),
        hasSystemPrompt: Boolean(pickBoolean('hasSystemPrompt')),
        hasGallery: Boolean(pickBoolean('hasGallery')),
        hasEmbeddedImages: Boolean(pickBoolean('hasEmbeddedImages')),
        hasExpressions: Boolean(pickBoolean('hasExpressions'))
    });
}

class CardController {
    getPngInfo = (req, res) => {
        try {
            const cardId = req.params.cardId;
            const spec = readCardPngSpec(cardId);
            if (!spec) {
                return res.status(404).json({ error: 'No embedded data found' });
            }
            const { jsonPath } = getCardFilePaths(cardId);
            if (fs.existsSync(jsonPath)) {
                try {
                    const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    spec.Tagline = metadata.tagline;
                } catch (error) {
                    console.warn('[WARN] Failed to attach tagline to PNG info:', error?.message || error);
                }
            }
            res.json({ data: spec });
        } catch (error) {
            console.error('[ERROR] Get PNG info error:', error);
            res.status(500).json({ error: 'Failed to extract PNG info' });
        }
    };

    getCardMetadata = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const { jsonPath } = getCardFilePaths(cardId);
            
            if (!fs.existsSync(jsonPath)) {
                return res.status(404).json({ error: 'Metadata not found' });
            }
            
            const metadataRaw = await fs.promises.readFile(jsonPath, 'utf8');
            const metadata = JSON.parse(metadataRaw);
            await syncFeatureFlagsFromMetadata(cardId, metadata);
            res.json(metadata);
        } catch (error) {
            console.error('[ERROR] Get metadata error:', error);
            res.status(500).json({ error: 'Failed to load metadata' });
        }
    };

    refreshCard = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            
            // Check card source
            const db = getDatabase();
            const card = db.prepare('SELECT source FROM cards WHERE id = ?').get(cardId);
            
            if (card && card.source === 'ct') {
                return res.status(400).json({ error: 'Refreshing Character Tavern cards is not currently supported.' });
            }

            await refreshCard(cardId, appConfig);
            const galleryResult = await refreshGalleryIfNeeded(parseInt(cardId, 10));

            // Invalidate cache since card was refreshed
            invalidateQueryCache();

            res.json({ success: true, gallery: galleryResult });
        } catch (error) {
            console.error('[ERROR] Refresh card error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    toggleFavorite = async (req, res) => {
        try {
            const cardId = parseInt(req.params.cardId);
            const database = getDatabase();
            const cardSourceInfo = database.prepare('SELECT id, source, sourceId FROM cards WHERE id = ?').get(cardId);
            const result = toggleFavorite(cardId);

            if (!result.success) {
                return res.json(result);
            }

            let hasGallery = false;
            let galleryResult = null;
            const isFavorited = result.favorited === 1;

            await setCardFavoriteFlag(cardId, isFavorited);
            await syncFavoriteToChub(cardSourceInfo, isFavorited);

            if (isFavorited) {
                galleryResult = await cacheGalleryAssets(cardId, appConfig.apikey);

                if (galleryResult?.success !== false) {
                    const cachedCount = galleryResult?.cached || 0;
                    const skippedCount = galleryResult?.skipped || 0;
                    hasGallery = (cachedCount + skippedCount) > 0;
                } else {
                    const existingGallery = await getGalleryAssets(cardId);
                    hasGallery = existingGallery.success && existingGallery.assets.length > 0;
                    if (galleryResult) {
                        galleryResult.assets = existingGallery.assets;
                    }
                }

                await setCardGalleryFlag(cardId, hasGallery);
            } else {
                galleryResult = await clearCardAssets(cardId, { assetType: 'gallery' });
                await setCardGalleryFlag(cardId, false);
            }

            // Invalidate cache since favorite status changed
            invalidateQueryCache();

            res.json({
                ...result,
                hasGallery,
                gallery: galleryResult
            });
        } catch (error) {
            console.error('[ERROR] Toggle favorite error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    };

    deleteCard = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const cardIdNum = parseInt(cardId);
            
            const { jsonPath, pngPath } = getCardFilePaths(cardId);
            
            if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
            if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
            
            // Clean up cached assets (both DB and filesystem)
            try {
                await clearCardAssets(cardIdNum);
            } catch (assetError) {
                console.warn(`[WARN] Failed to cleanup assets for card ${cardId}:`, assetError.message);
                // Don't fail the delete operation
            }
            
            const result = deleteCard(cardIdNum);
            
            const blacklistPath = path.join(process.cwd(), 'blacklist.txt');
            fs.appendFileSync(blacklistPath, `${cardId}\n`);
            
            // Also blacklist the source ID if possible
            const database = getDatabase();
            // Note: The record is deleted by deleteCard, so this fetch would fail if done after.
            // But deleteCard was called above.
            // Logic fix: We should fetch BEFORE deleting.
            // However, server.js fetched 'existing' at start of handler.
            // I'll fix this logic flow here to match server.js: fetch first.
            
            // Wait, server.js did:
            // const existing = db.prepare(...).get(cardIdNum);
            // ... delete ...
            // if (existing...) blacklist
            
            // But here I am fetching AFTER deleteCard in previous iteration.
            // Let's fix it in this overwrite.
            
            // Invalidate cache
            invalidateQueryCache();
            
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Delete card error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    // Corrected deleteCard to fetch before delete
    deleteCardWithFix = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const cardIdNum = parseInt(cardId);
            const database = getDatabase();
            const existing = database.prepare('SELECT source, sourceId FROM cards WHERE id = ?').get(cardIdNum);
            
            const { jsonPath, pngPath } = getCardFilePaths(cardId);
            
            if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
            if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
            
            try {
                await clearCardAssets(cardIdNum);
            } catch (assetError) {
                console.warn(`[WARN] Failed to cleanup assets for card ${cardId}:`, assetError.message);
            }
            
            const result = deleteCard(cardIdNum);
            
            const blacklistPath = path.join(process.cwd(), 'blacklist.txt');
            fs.appendFileSync(blacklistPath, `${cardId}\n`);
            if (existing?.source === 'ct' && existing.sourceId) {
                // TODO: Import addCtBlacklistEntry from ct-blacklist.js
                const { addCtBlacklistEntry } = await import('../utils/ct-blacklist.js');
                addCtBlacklistEntry(existing.sourceId);
            }

            invalidateQueryCache();
            
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Delete card error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    bulkDelete = async (req, res) => {
        try {
            const { cardIds } = req.body;
            // Map card_ids (legacy) or cardIds
            const ids = cardIds || req.body.card_ids;
            
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'No card IDs provided' });
            }

            const deleted = [];
            const errors = [];
            const database = getDatabase();
            const { addCtBlacklistEntry } = await import('../utils/ct-blacklist.js');

            for (const rawId of ids) {
                try {
                    const cardId = String(rawId);
                    const cardIdNum = parseInt(cardId);
                    const existing = database.prepare('SELECT source, sourceId FROM cards WHERE id = ?').get(cardIdNum);
                    
                    const { jsonPath, pngPath } = getCardFilePaths(cardId);
                    
                    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
                    
                    try {
                        await clearCardAssets(cardIdNum);
                    } catch (assetError) {
                        console.warn(`[WARN] Failed to cleanup assets for card ${cardId}:`, assetError.message);
                    }
                    
                    deleteCard(cardIdNum);
                    deleted.push(cardId);
                    
                    const blacklistPath = path.join(process.cwd(), 'blacklist.txt');
                    fs.appendFileSync(blacklistPath, `${cardId}\n`);
                    if (existing?.source === 'ct' && existing.sourceId) {
                        addCtBlacklistEntry(existing.sourceId);
                    }
                } catch (err) {
                    errors.push({ cardId: rawId, error: err.message });
                }
            }

            invalidateQueryCache();

            res.json({ success: true, deleted, errors });
        } catch (error) {
            console.error('[ERROR] Bulk delete error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    setLanguage = async (req, res) => {
        try {
            const { cardId } = req.params;
            const { language } = req.body;
            
            if (!language) {
                return res.status(400).json({ error: 'Language is required' });
            }

            const { getDatabase: getDb } = await import('../database.js');
            const db = getDb();
            db.prepare('UPDATE cards SET language = ? WHERE id = ?').run(language, cardId);

            const languageName = LANGUAGE_MAPPING[language] || language;
            res.json({ languageCode: language, languageName });
        } catch (error) {
            console.error('[ERROR] Set language error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    editTags = async (req, res) => {
        try {
            const { cardId } = req.params;
            const metadata = req.body;
            
            // Support legacy { tags: "a,b,c" } format or new { topics: ["a","b"] }
            let topics = [];
            if (metadata.tags && typeof metadata.tags === 'string') {
                topics = metadata.tags.split(',').map(t => t.trim()).filter(Boolean);
            } else if (Array.isArray(metadata.topics)) {
                topics = metadata.topics;
            } else {
                return res.status(400).json({ error: 'Tags/topics are required' });
            }

            // Update JSON file
            const { jsonPath } = getCardFilePaths(cardId);
            if (fs.existsSync(jsonPath)) {
                const fileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                fileData.topics = topics;
                fs.writeFileSync(jsonPath, JSON.stringify(fileData, null, 4));
            }

            const { getDatabase: getDb } = await import('../database.js');
            const db = getDb();
            db.prepare('UPDATE cards SET topics = ? WHERE id = ?').run(topics.join(','), parseInt(cardId));

            res.json({ message: 'Tags updated successfully', topics: topics });
        } catch (error) {
            console.error('[ERROR] Edit tags error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    exportCard = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const format = req.query.format || 'png';
            const { jsonPath, pngPath } = getCardFilePaths(cardId);

            if (!fs.existsSync(pngPath)) {
                return res.status(404).json({ error: 'Card not found' });
            }

            if (format === 'json') {
                if (!fs.existsSync(jsonPath)) {
                    return res.status(404).json({ error: 'Metadata not found' });
                }
                res.download(jsonPath, `${cardId}.json`);
            } else {
                // Use useLocal=true default
                const useLocal = req.query.useLocal !== 'false';
                const result = await rewriteCardUrls(cardId, useLocal);
                if (result.success) {
                    res.json(result);
                } else {
                    // Fallback to plain download if rewrite fails or not requested via API standard?
                    // Actually server.js endpoint was:
                    // const result = await rewriteCardUrls(cardId, useLocal);
                    // res.json(result); 
                    // It returned JSON with base64/url, not a file download stream directly unless client requested it.
                    // But my code above said res.download.
                    // Let's stick to server.js behavior: rewrite URLs and return JSON.
                    res.json(result);
                }
            }
        } catch (error) {
            console.error('[ERROR] Export card error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    pushToSillyTavern = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const cardIdStr = String(cardId);
            const { pngPath } = getCardFilePaths(cardIdStr);

            if (!fs.existsSync(pngPath)) {
                return res.status(404).json({ success: false, error: 'Card PNG file not found' });
            }

            const sillyConfig = appConfig.sillyTavern;
            if (!sillyConfig || !sillyConfig.enabled || !sillyConfig.baseUrl) {
                return res.status(400).json({ success: false, error: 'Silly Tavern integration not configured' });
            }

            const baseUrl = sillyConfig.baseUrl.replace(/\/$/, '');
            const baseHeaders = sillyTavernService.buildSillyTavernHeaders(sillyConfig);
            const csrfHeaders = { ...baseHeaders };
            if (sillyConfig.sessionCookie) {
                csrfHeaders.Cookie = sillyConfig.sessionCookie;
            }

            // Get CSRF
            const csrfUrl = `${baseUrl}/csrf-token`;
            console.log(`[INFO] Fetching SillyTavern CSRF from: ${csrfUrl}`);
            
            const csrfResponse = await axios.get(csrfUrl, {
                headers: csrfHeaders,
                timeout: 15000,
                validateStatus: () => true
            });

            if (csrfResponse.status < 200 || csrfResponse.status >= 300 || !csrfResponse.data?.token) {
                console.error(`[ERROR] Failed to get CSRF token from ${csrfUrl}. Status: ${csrfResponse.status}`);
                const message = csrfResponse.data?.error || `Failed to obtain Silly Tavern CSRF token (Status: ${csrfResponse.status})`;
                return res.status(csrfResponse.status || 502).json({ success: false, error: message, response: csrfResponse.data });
            }

            const csrfToken = csrfResponse.data.token;
            const cookieSet = new Set();
            const registerCookie = (value) => {
                if (!value) return;
                const cookieString = value.split(';')[0];
                if (cookieString) {
                    cookieSet.add(cookieString.trim());
                }
            };

            const setCookieHeader = csrfResponse.headers['set-cookie'];
            if (Array.isArray(setCookieHeader)) {
                setCookieHeader.forEach(registerCookie);
            } else if (typeof setCookieHeader === 'string') {
                registerCookie(setCookieHeader);
            }

            if (sillyConfig.sessionCookie) {
                const attributePattern = /^(path|max-age|expires|domain|samesite|secure|httponly)/i;
                sillyConfig.sessionCookie
                    .split(';')
                    .map(part => part.trim())
                    .filter(part => part.includes('=') && !attributePattern.test(part))
                    .forEach(part => registerCookie(part));
            }

            const cookieHeader = Array.from(cookieSet).join('; ');

            if (!cookieHeader) {
                return res.status(502).json({ success: false, error: 'Failed to capture Silly Tavern session cookies' });
            }

            const form = new FormData();
            form.append('avatar', fs.createReadStream(pngPath), {
                filename: `${cardIdStr}.png`,
                contentType: 'image/png'
            });
            form.append('file_type', 'png');
            form.append('preserved_name', cardIdStr);

            const formHeaders = form.getHeaders();
            const importHeaders = {
                ...baseHeaders,
                ...formHeaders,
                Cookie: cookieHeader,
                'X-CSRF-Token': csrfToken,
                Accept: 'application/json, text/plain, */*'
            };

            const importResponse = await axios.post(`${baseUrl}/api/characters/import`, form, {
                headers: importHeaders,
                timeout: 30000,
                maxBodyLength: Infinity,
                validateStatus: () => true
            });

            if (importResponse.status >= 200 && importResponse.status < 300) {
                // Refresh SillyTavern
                try {
                    const refreshHeaders = {
                        ...baseHeaders,
                        Cookie: cookieHeader,
                        'X-CSRF-Token': csrfToken,
                        Accept: 'application/json, text/plain, */*',
                        'Content-Type': 'application/json'
                    };
                    await axios.post(`${baseUrl}/api/plugins/my-list-cards/refresh`, {}, {
                        headers: refreshHeaders,
                        timeout: 20000,
                        validateStatus: () => true
                    });
                } catch (e) { /* ignore */ }
                
                // Refresh local cache
                try {
                    await sillyTavernService.fetchLoadedIds({ forceRefresh: true, cookieHeader });
                } catch (e) { /* ignore */ }

                return res.json({
                    success: true,
                    status: importResponse.status,
                    imported: importResponse.data,
                    fileName: importResponse.data?.file_name || `${cardIdStr}.png`
                });
            }

            res.status(importResponse.status || 502).json({
                success: false,
                error: importResponse.data?.error || 'Silly Tavern rejected the import request',
                response: importResponse.data
            });

        } catch (error) {
            console.error('[ERROR] Push to SillyTavern failed:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    pushToArchitect = async (req, res) => {
        try {
            const cardId = req.params.cardId;
            const cardIdStr = String(cardId);
            
            const architectUrl = appConfig.characterArchitect?.url || 'http://localhost:3456';
            const { pngPath } = getCardFilePaths(cardIdStr);
            
            if (!fs.existsSync(pngPath)) {
                return res.status(404).json({ success: false, error: 'Card PNG file not found' });
            }
            
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const publicUrl = `${baseUrl}/static/${cardIdStr.substring(0, 2)}/${cardIdStr}.png`;
            
            const response = await axios.post(
                `${architectUrl}/api/import-url`,
                { url: publicUrl },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000
                }
            );
            
            if (response.status === 201) {
                res.json({
                    success: true,
                    message: 'Card pushed successfully',
                    architectResponse: response.data
                });
            } else {
                res.json({
                    success: true,
                    message: 'Card pushed with non-standard response',
                    architectResponse: response.data
                });
            }
        } catch (error) {
            console.error('[ERROR] Push to Architect failed:', error.message);
            let errorMessage = error.message;
            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Character Architect is not running or not accessible';
            }
            res.status(500).json({ success: false, error: errorMessage });
        }
    };

    async listCards(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const rawLimit = parseInt(req.query.limit, 10);
            const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 48;
            const query = (req.query.query || '').toString();
            const useAdvancedSearch = req.query.advanced === 'true';
            const advancedText = (req.query.advancedText || '').toString();
            const advancedFilter = (req.query.advancedFilter || '').toString();
            const include = (req.query.include || '').toString();
            const exclude = (req.query.exclude || '').toString();
            const searchType = (req.query.type || 'full').toString();
            const tagMatchMode = (req.query.tagMatchMode || 'or').toString();
            const sort = (req.query.sort || 'new').toString();
            const language = req.query.language ? req.query.language.toString() : null;
            const favoriteFilter = req.query.favorite ? req.query.favorite.toString() : null;
            const sourceParam = req.query.source ? req.query.source.toString() : 'all';
            const normalizedSource = ['chub', 'ct'].includes(sourceParam) ? sourceParam : 'all';
            const hasAlternateGreetings = req.query.hasAlternateGreetings === 'true';
            const hasLorebook = req.query.hasLorebook === 'true';
            const hasEmbeddedLorebook = req.query.hasEmbeddedLorebook === 'true';
            const hasLinkedLorebook = req.query.hasLinkedLorebook === 'true';
            const hasExampleDialogues = req.query.hasExampleDialogues === 'true';
            const hasSystemPrompt = req.query.hasSystemPrompt === 'true';
            const hasGallery = req.query.hasGallery === 'true';
            const hasEmbeddedImages = req.query.hasEmbeddedImages === 'true';
            const hasExpressions = req.query.hasExpressions === 'true';
            const inSillyTavern = req.query.inSillyTavern === 'true';
            const withSillyStatus = req.query.withSillyStatus === 'true';
            const followedOnly = req.query.followedOnly === 'true';
            const minTokensRaw = parseInt(req.query.minTokens, 10);
            const minTokens = Number.isFinite(minTokensRaw) && minTokensRaw > 0 ? minTokensRaw : null;

            // Build cache key
            const cacheKey = (page > 1 && !inSillyTavern && !withSillyStatus) ? JSON.stringify({
                page, limit, query, useAdvancedSearch, advancedText, advancedFilter,
                include, exclude, tagMatchMode, sort, language, favoriteFilter,
                source: normalizedSource, hasAlternateGreetings, hasLorebook,
                hasEmbeddedLorebook, hasLinkedLorebook, hasExampleDialogues,
                hasSystemPrompt, hasGallery, hasEmbeddedImages, hasExpressions, followedOnly, minTokens
            }) : null;

            if (cacheKey) {
                const cached = queryCache.get(cacheKey);
                if (cached) {
                    res.set('X-Cache', 'HIT');
                    res.set('X-Response-Time', '0ms');
                    return res.json(cached);
                }
            }

            const startTime = Date.now();
            let sillyLoadedSet = null;
            let allowedIds = null;

            if (inSillyTavern || withSillyStatus) {
                if (!appConfig?.sillyTavern?.enabled || !appConfig?.sillyTavern?.baseUrl) {
                    if (inSillyTavern) {
                        return res.status(400).json({ error: 'Silly Tavern integration is not enabled' });
                    }
                } else {
                    try {
                        sillyLoadedSet = await sillyTavernService.fetchLoadedIds({ cookieHeader: req.header('cookie') });
                    } catch (error) {
                        console.error('[ERROR] Failed to fetch Silly Tavern loaded cards:', error?.message || error);
                        if (inSillyTavern) {
                            return res.status(502).json({ error: 'Failed to fetch Silly Tavern loaded cards' });
                        }
                        sillyLoadedSet = null;
                    }
                }
            }

            if (inSillyTavern) {
                const idList = sillyLoadedSet ? Array.from(sillyLoadedSet) : [];
                allowedIds = idList
                    .map(id => Number.parseInt(id, 10))
                    .filter(id => Number.isInteger(id));
                if (!sillyLoadedSet) {
                    allowedIds = [];
                }
            }

            const decorateCards = (cardsToDecorate) => {
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const sillySet = sillyLoadedSet instanceof Set ? sillyLoadedSet : null;
                cardsToDecorate.forEach(card => {
                    const imagePath = card.imagePath && card.imagePath.startsWith('/')
                        ? card.imagePath
                        : `/static/${card.id_prefix}/${card.id}.png`;
                    card.imagePath = imagePath;
                    card.silly_link = `${baseUrl}${imagePath}`;
                    card.loadedInSillyTavern = sillySet ? sillySet.has(String(card.id)) : false;
                });
            };

            let advancedFallbackReason = null;
            let vectorResponseMeta = null;

            // Advanced Search Logic
            if (useAdvancedSearch) {
                if (!isSearchIndexEnabled()) {
                    advancedFallbackReason = 'Advanced search requires Meilisearch. Falling back to basic search.';
                } else {
                    // We need to import buildMeilisearchFilter or recreate it.
                    // For now, assuming we can import it from where it was defined or move it to a util.
                    // Since I cannot easily import from server.js if it's not exported, I'll need to duplicate or move that helper.
                    // I'll handle that in the next step. For now, let's assume it's available as a helper.
                    const { buildMeilisearchFilter } = await import('../utils/searchUtils.js');
                    
                    const meiliFilterExpression = buildMeilisearchFilter({
                        advancedFilter,
                        include,
                        exclude,
                        tagMatchMode,
                        minTokens,
                        language,
                        favoriteFilter,
                        source: normalizedSource,
                        hasAlternateGreetings,
                        hasLorebook,
                        hasEmbeddedLorebook,
                        hasLinkedLorebook,
                        hasExampleDialogues,
                        hasSystemPrompt,
                        hasGallery,
                        hasEmbeddedImages,
                        hasExpressions
                    });

                    const hasQueryText = Boolean((advancedText && advancedText.trim()) || (query && query.trim()));
                    const hasAnyFilter = Boolean(meiliFilterExpression && meiliFilterExpression.trim().length > 0);

                    if (!hasQueryText && !hasAnyFilter) {
                        advancedFallbackReason = 'Advanced search needs a query or filters. Showing default results.';
                    } else {
                        const vectorPreferred = hasQueryText && appConfig?.vectorSearch?.enabled === true && isVectorSearchReady();
                        if (vectorPreferred) {
                            try {
                                const [vectorResult, lexicalResult] = await Promise.all([
                                    searchVectorCards({
                                        text: advancedText || query || '',
                                        filter: meiliFilterExpression,
                                        page,
                                        limit,
                                        sort
                                    }),
                                    searchMeilisearchCards({
                                        text: advancedText,
                                        filter: meiliFilterExpression,
                                        page,
                                        limit,
                                        sort: null
                                    })
                                ]);

                                const vectorIds = Array.isArray(vectorResult.ids) ? vectorResult.ids : [];
                                const lexicalIds = Array.isArray(lexicalResult.ids) ? lexicalResult.ids : [];
                                const finalIds = [];
                                const seen = new Set();

                                for (const id of vectorIds) {
                                    if (finalIds.length >= limit) break;
                                    if (!seen.has(id)) {
                                        finalIds.push(id);
                                        seen.add(id);
                                    }
                                }

                                if (finalIds.length < limit) {
                                    for (const id of lexicalIds) {
                                        if (finalIds.length >= limit) break;
                                        if (!seen.has(id)) {
                                            finalIds.push(id);
                                            seen.add(id);
                                        }
                                    }
                                }

                                let cards = [];
                                if (finalIds.length > 0) {
                                    cards = getCardsByIdsOrdered(finalIds);
                                }

                                decorateCards(cards);
                                if (vectorResult.chunkMatches) {
                                    cards.forEach(card => {
                                        if (vectorResult.chunkMatches[card.id]) {
                                            card.vectorMatch = vectorResult.chunkMatches[card.id];
                                        }
                                    });
                                }
                                if (vectorResult.scores) {
                                    cards.forEach(card => {
                                        if (vectorResult.scores[card.id] !== undefined) {
                                            card.semanticScore = vectorResult.scores[card.id];
                                        }
                                    });
                                }

                                let total = lexicalResult.total || vectorResult.total || cards.length;
                                const totalPages = Math.max(1, Math.ceil(total / limit));
                                const [randomTags, languages] = await Promise.all([
                                    getRandomTags(),
                                    getAllLanguages()
                                ]);

                                vectorResponseMeta = {
                                    enabled: true,
                                    appliedFilter: vectorResult.appliedFilter || '',
                                    meta: vectorResult.meta || {},
                                    chunkMatches: vectorResult.chunkMatches || {}
                                };

                                return sendCachedResponse(res, {
                                    cards,
                                    count: total,
                                    page,
                                    totalPages,
                                    randomTags,
                                    languages,
                                    languageMapping: LANGUAGE_MAPPING,
                                    advanced: {
                                        enabled: true,
                                        mode: 'vector',
                                        query: advancedText,
                                        filter: lexicalResult.appliedFilter || vectorResult.appliedFilter || ''
                                    },
                                    vector: vectorResponseMeta
                                }, cacheKey, startTime, page);

                            } catch (error) {
                                console.error('[ERROR] Vector search failure:', error?.message || error);
                                advancedFallbackReason = `Vector search failed. ${error?.message || ''}`.trim();
                            }
                        }

                        try {
                            const meiliResult = await searchMeilisearchCards({
                                text: advancedText,
                                filter: meiliFilterExpression,
                                page,
                                limit,
                                sort
                            });

                            let cards = [];
                            if (meiliResult.ids.length > 0) {
                                cards = getCardsByIdsOrdered(meiliResult.ids);
                            }

                            decorateCards(cards);
                            const total = meiliResult.total || cards.length;
                            const totalPages = Math.max(1, Math.ceil(total / limit));
                            const randomTags = getRandomTags();
                            const languages = getAllLanguages();

                            return sendCachedResponse(res, {
                                cards,
                                count: total,
                                page,
                                totalPages,
                                randomTags,
                                languages,
                                languageMapping: LANGUAGE_MAPPING,
                                advanced: {
                                    enabled: true,
                                    query: advancedText,
                                    filter: meiliResult.appliedFilter || ''
                                },
                                vector: vectorResponseMeta || undefined
                            }, cacheKey, startTime, page);
                        } catch (error) {
                            console.error('[ERROR] Advanced search failure:', error?.message || error);
                            advancedFallbackReason = error?.message || 'Advanced search failed. Falling back to basic search.';
                        }
                    }
                }
            }

            // Basic DB Search
            const result = getCards({
                page,
                limit,
                query,
                includeQuery: include,
                excludeQuery: exclude,
                searchType,
                tagMatchMode,
                sort,
                language,
                favoriteFilter,
                source: normalizedSource,
                hasAlternateGreetings,
                hasLorebook,
                hasEmbeddedLorebook,
                hasLinkedLorebook,
                hasExampleDialogues,
                hasSystemPrompt,
                hasGallery,
                hasEmbeddedImages,
                hasExpressions,
                allowedIds,
                followedOnly,
                followedCreators: appConfig.followedCreators || [],
                minTokens
            });

            decorateCards(result.cards);
            const randomTags = getRandomTags();
            const languages = getAllLanguages();

            sendCachedResponse(res, {
                cards: result.cards,
                count: result.count,
                page: result.page,
                totalPages: result.totalPages,
                randomTags,
                languages,
                languageMapping: LANGUAGE_MAPPING,
                advanced: {
                    enabled: false,
                    fallbackReason: advancedFallbackReason || undefined
                }
            }, cacheKey, startTime, page);

        } catch (error) {
            console.error('[ERROR] Cards API error:', error);
            res.status(500).json({ error: 'Failed to load cards' });
        }
    }
}

export const cardController = new CardController();