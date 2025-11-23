
import { loadConfig } from '../../config.js';

// Singleton configuration object
// We load it once and mutate it in place so that all references stay updated.
export const appConfig = loadConfig();
