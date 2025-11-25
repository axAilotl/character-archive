
import { loadConfig } from '../../config.js';
import { syncCards } from './scraper.js';
import { syncCharacterTavern } from './ct-sync.js';
import { drainSearchIndexQueue, isSearchIndexEnabled } from './search-index.js';
import { lockService } from './LockService.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('SCHEDULER');

class SchedulerService {
    constructor() {
        this.autoUpdateTimer = null;
        this.ctAutoUpdateTimer = null;
        this.searchIndexRefreshTimer = null;
        this.searchIndexQueueTimer = null;
        
        this.SEARCH_INDEX_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
        this.SEARCH_INDEX_QUEUE_INTERVAL_MS = 5000;
    }

    startAutoUpdate() {
        if (this.autoUpdateTimer) {
            clearInterval(this.autoUpdateTimer);
            this.autoUpdateTimer = null;
        }

        const currentConfig = loadConfig();
        if (!currentConfig.autoUpdateMode) {
            console.log('[INFO] Auto-update is disabled');
            return;
        }

        const interval = (currentConfig.autoUpdateInterval || 900) * 1000;
        console.log(`[INFO] Auto-update enabled with ${currentConfig.autoUpdateInterval}s interval`);

        this.autoUpdateTimer = setInterval(async () => {
            if (lockService.isSyncInProgress()) {
                console.log('[INFO] Sync already in progress, skipping auto-update');
                return;
            }

            console.log('[INFO] Auto-update triggered');
            lockService.setSyncInProgress(true);
            try {
                await syncCards(loadConfig(), (progress) => {
                    if (progress.progress % 25 === 0 || progress.progress === 100) {
                        console.log(`[INFO] Auto-update progress: ${progress.progress}%`);
                    }
                });
                console.log('[INFO] Auto-update complete');
                await drainSearchIndexQueue('auto-update');
            } catch (error) {
                log.error('Auto-update failed', error);
            } finally {
                lockService.setSyncInProgress(false);
            }
        }, interval);
    }

    startCtAutoUpdate() {
        if (this.ctAutoUpdateTimer) {
            clearInterval(this.ctAutoUpdateTimer);
            this.ctAutoUpdateTimer = null;
        }

        const currentConfig = loadConfig();
        const ctConfig = currentConfig.ctSync || {};
        if (!ctConfig.enabled) {
            console.log('[INFO] Character Tavern auto-sync is disabled');
            return;
        }

        const intervalMs = Math.max(1, ctConfig.intervalMinutes || 180) * 60 * 1000;
        console.log(`[INFO] Character Tavern auto-sync enabled with ${ctConfig.intervalMinutes || 180} minute interval`);

        this.ctAutoUpdateTimer = setInterval(async () => {
            if (lockService.isCtSyncInProgress()) {
                console.log('[INFO] CT sync already in progress, skipping auto-sync run');
                return;
            }

            console.log('[INFO] Character Tavern auto-sync triggered');
            lockService.setCtSyncInProgress(true);
            try {
                await syncCharacterTavern(loadConfig(), progress => {
                    if (progress.processed % 25 === 0) {
                        console.log(`[INFO] CT auto-sync processed ${progress.processed} cards (added ${progress.added})`);
                    }
                });
                console.log('[INFO] Character Tavern auto-sync complete');
                await drainSearchIndexQueue('ct-auto-sync');
            } catch (error) {
                log.error('Character Tavern auto-sync failed', error);
            } finally {
                lockService.setCtSyncInProgress(false);
            }
        }, intervalMs);
    }
    
    startSearchIndexScheduler() {
        if (this.searchIndexRefreshTimer) {
            clearInterval(this.searchIndexRefreshTimer);
            this.searchIndexRefreshTimer = null;
        }
        if (this.searchIndexQueueTimer) {
            clearInterval(this.searchIndexQueueTimer);
            this.searchIndexQueueTimer = null;
        }

        if (!isSearchIndexEnabled()) {
            return;
        }

        this.searchIndexQueueTimer = setInterval(() => {
            drainSearchIndexQueue('interval');
        }, this.SEARCH_INDEX_QUEUE_INTERVAL_MS);
    }
}

export const schedulerService = new SchedulerService();
