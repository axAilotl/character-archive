
import { saveConfig } from '../../config.js';
import { appConfig } from '../services/ConfigState.js';
import { sillyTavernService } from '../services/SillyTavernService.js';
import { schedulerService } from '../services/SchedulerService.js';
import { configureSearchIndex, configureVectorSearch, isSearchIndexEnabled, drainSearchIndexQueue } from '../services/search-index.js';

class ConfigController {
    getConfig = (req, res) => {
        res.json(appConfig);
    };

    setConfig = async (req, res) => {
        try {
            const newConfig = { ...appConfig, ...req.body };
            
            if (newConfig.use_timeline && !newConfig.apikey) {
                return res.status(400).json({ error: 'use_timeline requires a valid API key' });
            }
            
            saveConfig(newConfig);
            
            // Mutate the singleton to update all references
            Object.assign(appConfig, newConfig);
            
            sillyTavernService.resetCache();
            
            configureSearchIndex(appConfig.meilisearch);
            configureVectorSearch(appConfig.vectorSearch || {});
            
            schedulerService.startSearchIndexScheduler();
            if (isSearchIndexEnabled()) {
                drainSearchIndexQueue('config-update');
            }

            // Restart auto-update if settings changed
            schedulerService.startAutoUpdate();
            schedulerService.startCtAutoUpdate();
            
            res.json({ message: 'Successfully updated the config' });
        } catch (error) {
            console.error('[ERROR] Set config error:', error);
            res.status(500).json({ error: error.message });
        }
    };
}

export const configController = new ConfigController();
