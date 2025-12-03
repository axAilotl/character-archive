import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rateLimitedRequest } from './ApiClient.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('LOREBOOK');
const fsp = fs.promises;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.join(__dirname, '../../static');
const LOREBOOKS_DIR = path.join(STATIC_DIR, 'lorebooks');

// Ensure lorebooks directory exists
if (!fs.existsSync(LOREBOOKS_DIR)) {
    fs.mkdirSync(LOREBOOKS_DIR, { recursive: true });
}

async function pathExists(filePath) {
    try {
        await fsp.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Download a single lorebook by ID
 */
export async function downloadLorebook(lorebookId, client) {
    const id = String(lorebookId);
    const outputPath = path.join(LOREBOOKS_DIR, `${id}.json`);

    if (await pathExists(outputPath)) {
        // For now, skip if exists. In future, we can add update logic similar to cards.
        return false;
    }

    try {
        // Fetch from Chub API
        // Note: Endpoint might be /api/lorebooks/{id} or similar. 
        // Based on Chub API patterns: https://gateway.chub.ai/api/lorebooks/{id}
        const response = await rateLimitedRequest(`https://gateway.chub.ai/api/lorebooks/${id}`, {
            headers: client.defaults.headers
        });

        const data = response.data;
        const definition = data?.definition;

        if (!definition) {
            throw new Error('No definition found in lorebook response');
        }

        await fsp.writeFile(outputPath, JSON.stringify(definition, null, 4));
        log.info(`Downloaded lorebook ${id}: ${data.name || 'Unknown'}`);
        return true;
    } catch (error) {
        log.warn(`Failed to download lorebook ${id}`, error.message);
        return false;
    }
}

/**
 * Sync all linked lorebooks for a card
 * @param {object} cardMetadata - The card metadata object
 * @param {object} client - Axios client instance
 */
export async function syncLinkedLorebooks(cardMetadata, client) {
    if (!cardMetadata || !Array.isArray(cardMetadata.related_lorebooks)) {
        return 0;
    }

    let downloadedCount = 0;
    const linkedIds = cardMetadata.related_lorebooks;

    for (const id of linkedIds) {
        // Skip invalid IDs (like -1 or null)
        if (!id || id === -1 || id === '-1') continue;

        const result = await downloadLorebook(id, client);
        if (result) downloadedCount++;
    }

    return downloadedCount;
}

export default {
    downloadLorebook,
    syncLinkedLorebooks
};
