import { syncCards } from '../services/scraper.js';
import { syncCharacterTavern } from '../services/ct-sync.js';
import { fetchChubFollows } from '../services/SyncService.js';
import { lockService } from '../services/LockService.js';
import { getDatabase } from '../database.js';
import { logger } from '../utils/logger.js';
import { appConfig } from '../services/ConfigState.js';
import { drainSearchIndexQueue } from '../services/search-index.js';

class SyncController {
    async getChubFollows(req, res) {
        try {
            const queryProfile = typeof req.query.profile === 'string' ? req.query.profile : Array.isArray(req.query.profile) ? req.query.profile[0] : '';
            const profile = (queryProfile || appConfig.chubProfileName || '').trim();
            if (!profile) {
                return res.status(400).json({ error: 'Missing Chub profile name' });
            }

            const result = await fetchChubFollows(profile);
            res.json(result);
        } catch (error) {
            console.error('[ERROR] Failed to fetch Chub follows:', error?.message || error);
            res.status(502).json({ error: error?.message || 'Failed to fetch followed creators from Chub' });
        }
    }

    async syncCards(req, res) {
        if (lockService.isSyncInProgress()) {
            return res.status(409).json({ error: 'Sync already in progress' });
        }
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        lockService.setSyncInProgress(true);
        
        try {
            const result = await syncCards(appConfig, (progress) => {
                res.write(`data: ${JSON.stringify(progress)}

`);
            });
            
            res.write(`data: ${JSON.stringify({
                progress: 100,
                currentCard: 'Sync Complete',
                newCards: result.newCards
            })}

`);
            await drainSearchIndexQueue('manual-sync');
            res.end();
        } catch (error) {
            console.error('[ERROR] Sync error:', error);
            res.write(`data: ${JSON.stringify({ error: error.message })}

`);
            res.end();
        } finally {
            lockService.setSyncInProgress(false);
        }
    }

    async syncCharacterTavern(req, res) {
        if (lockService.isCtSyncInProgress()) {
            return res.status(409).json({ error: 'Character Tavern sync already in progress' });
        }

        if (!appConfig?.ctSync?.enabled) {
            return res.status(400).json({ error: 'Character Tavern sync is disabled in config' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        lockService.setCtSyncInProgress(true);

        try {
            const result = await syncCharacterTavern(appConfig, progress => {
                res.write(`data: ${JSON.stringify(progress)}

`);
            });

            res.write(`data: ${JSON.stringify({
                progress: 100,
                currentCard: 'CT Sync Complete',
                newCards: result.added,
            })}

`);
            await drainSearchIndexQueue('ct-sync');
            res.end();
        } catch (error) {
            console.error('[ERROR] CT Sync error:', error);
            res.write(`data: ${JSON.stringify({ error: error.message })}

`);
            res.end();
        } finally {
            lockService.setCtSyncInProgress(false);
        }
    }

    async syncFavoritesToChub(req, res) {
        try {
            const apiKey = (appConfig.apikey || '').trim();
            if (!apiKey) {
                return res.status(400).json({ success: false, message: 'Chub API key missing in config' });
            }

            const database = getDatabase();
            const limitValue = Number(req.body?.limit);
            const dryRun = !!req.body?.dryRun;

            let sql = `
                SELECT id, source, sourceId, name
                FROM cards
                WHERE favorited = 1
                  AND (
                      source IS NULL
                      OR LOWER(source) = 'chub'
                      OR LOWER(source) = 'chub.ai'
                  )
                ORDER BY id ASC
            `;

            if (Number.isInteger(limitValue) && limitValue > 0) {
                sql += ` LIMIT ${limitValue}`;
            }

            const favorites = database.prepare(sql).all();
            const stats = {
                total: favorites.length,
                attempted: 0,
                synced: 0,
                failed: 0,
                skipped: 0
            };

            for (const card of favorites) {
                if (dryRun) {
                    stats.skipped += 1;
                    continue;
                }

                stats.attempted += 1;
                const ok = await syncFavoriteToChub(card, true);
                if (ok) {
                    stats.synced += 1;
                } else {
                    stats.failed += 1;
                }
            }

            res.json({
                success: true,
                message: dryRun
                    ? 'Dry run complete – no remote updates sent'
                    : `Synced ${stats.synced} favorite(s) to Chub`,
                stats
            });
        } catch (error) {
            console.error('[ERROR] Favorite sync to Chub failed:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to sync favorites to Chub' });
        }
    }
}

export const syncController = new SyncController();
