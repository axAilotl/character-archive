
import { saveConfig } from '../../config.js';
import { appConfig } from '../services/ConfigState.js';
import { sillyTavernService } from '../services/SillyTavernService.js';
import { schedulerService } from '../services/SchedulerService.js';
import { configureSearchIndex, configureVectorSearch, isSearchIndexEnabled, drainSearchIndexQueue } from '../services/search-index.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('CONFIG');

// Keys that contain sensitive information and should be redacted in API responses
const REDACTED_KEYS = [
    'apikey', 'apiKey', 'bearerToken', 'sessionCookie', 'csrfToken',
    'cfClearance', 'session', 'CH-API-KEY', 'samwise'
];

/**
 * Recursively redact sensitive keys from an object
 */
function redactSecrets(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== 'object') return obj;
    const result = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
        if (REDACTED_KEYS.includes(key)) {
            result[key] = value ? '[REDACTED]' : '';
        } else if (typeof value === 'object' && value !== null) {
            result[key] = redactSecrets(value, depth + 1);
        } else {
            result[key] = value;
        }
    }
    return result;
}

class ConfigController {
    getConfig = (req, res) => {
        // Return config with sensitive fields redacted
        res.json(redactSecrets(appConfig));
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
            log.error('Set config error', error);
            res.status(500).json({ error: error.message });
        }
    };
}

export const configController = new ConfigController();
