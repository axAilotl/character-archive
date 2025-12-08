import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load as cheerioLoad } from 'cheerio';
import { getDatabase } from '../database.js';
import { logger } from '../utils/logger.js';
import { addToBlacklist, isBlacklisted, loadBlacklist, rateLimitedRequest } from './ApiClient.js';

const log = logger.scoped('RISUAI');
const fsp = fs.promises;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.join(__dirname, '../../static');

// Ensure risuai directory exists
const RISU_DIR = path.join(STATIC_DIR, 'risuai');
if (!fs.existsSync(RISU_DIR)) {
    fs.mkdirSync(RISU_DIR, { recursive: true });
}

const BASE_URL = 'https://realm.risuai.net';

/**
 * Fixes the specific JSON formatting issues found in RisuAI's embedded data
 */
function fixShittyRisuAiJson(jsonString) {
    if (!jsonString) return null;
    try {
        // Try parsing directly first
        return JSON.parse(jsonString);
    } catch (e) {
        // Simple regex fixes for common issues if direct parse fails
        // This mirrors the logic in the python script 'retarded_ass_json_fixer.py'
        // simplified for JS usage or we can implement a more robust parser if needed.
        // For now, let's try to clean up trailing commas which are common in "shitty" JSON
        try {
            const fixed = jsonString.replace(/,(\s*[}\]])/g, '$1');
            return JSON.parse(fixed);
        } catch (e2) {
            log.warn('Failed to fix/parse RisuAI JSON', e2.message);
            return null;
        }
    }
}

async function downloadFile(url, outputPath) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        await fsp.writeFile(outputPath, response.data);
        return true;
    } catch (error) {
        log.warn(`Failed to download file from ${url}`, error.message);
        return false;
    }
}

async function processRisuCard(cardUrl) {
    const fullUrl = `${BASE_URL}/${cardUrl.replace(/^\//, '')}`;
    
    try {
        const response = await rateLimitedRequest(fullUrl);
        const $ = cheerioLoad(response.data);
        
        // Find the script tag with the data
        const scripts = $('script');
        let cardData = null;
        let isCharX = false;

        scripts.each((i, el) => {
            const text = $(el).html();
            if (text && text.includes('data: [')) {
                const match = text.match(/data: \[.*?,({.*?})],/);
                if (match && match[1]) {
                    cardData = fixShittyRisuAiJson(match[1]);
                }
                if (text.includes('/api/v1/download/charx-v3/')) {
                    isCharX = true;
                }
            }
        });

        if (!cardData || !cardData.data || !cardData.data.card) {
            log.warn(`No card data found for ${cardUrl}`);
            return false;
        }

        const card = cardData.data.card;
        const id = card.id;

        if (isBlacklisted(id)) {
            log.info(`Skipping blacklisted card ${id}`);
            return false;
        }

        // Prepare storage
        const cardDir = path.join(RISU_DIR, String(id));
        if (!fs.existsSync(cardDir)) {
            fs.mkdirSync(cardDir, { recursive: true });
        }

        // Determine download URL and Extension
        let downloadUrl;
        let extension;
        
        if (isCharX) {
            downloadUrl = `${BASE_URL}/api/v1/download/charx-v3/${id}`;
            extension = 'charx';
        } else {
            // Defaulting to the json-v3 endpoint which returns the full card data
            // If there is a separate "PNG" endpoint for non-charx, it would be here.
            downloadUrl = `${BASE_URL}/api/v1/download/json-v3/${id}`;
            extension = 'json';
        }

        // Download the Main File (The "Big One")
        const mainFilePath = path.join(cardDir, `${id}.${extension}`);
        const dlResult = await downloadFile(downloadUrl, mainFilePath);
        
        if (!dlResult) {
            log.error(`Failed to download main file for ${id}`);
            return false;
        }

        // Download Avatar/Thumbnail
        if (card.img) {
            const imgUrl = `https://sv.risuai.xyz/resource/${card.img}`;
            await downloadFile(imgUrl, path.join(cardDir, 'avatar.png'));
        }

        // Save Metadata
        const metadataPath = path.join(cardDir, 'metadata.json');
        await fsp.writeFile(metadataPath, JSON.stringify(card, null, 2));

        // Insert into Database (Simplified for now)
        const db = getDatabase();
        // Check if exists
        const existing = db.prepare('SELECT id FROM cards WHERE source = ? AND sourceId = ?').get('risuai', id);
        
        if (!existing) {
             const insertSql = `
                INSERT INTO cards (
                    name, description, author, source, sourceId, sourceUrl, 
                    fullPath, hasLorebook, hasEmbeddedLorebook, downloadCount,
                    createdAt, lastModified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            db.prepare(insertSql).run(
                card.name,
                card.desc || '',
                card.authorname || 'Anonymous',
                'risuai',
                id,
                fullUrl,
                path.relative(STATIC_DIR, mainFilePath), // Relative path to the main file
                card.hasLore ? 1 : 0,
                0, // parsing required to determine if embedded
                Number(card.download) || 0,
                new Date(Number(card.date)).toISOString(),
                new Date().toISOString()
            );
            log.info(`Imported RisuAI card: ${card.name} (${id})`);
            return true;
        } else {
            // Update existing if needed
            return false;
        }

    } catch (error) {
        log.error(`Error processing RisuAI card ${cardUrl}`, error);
        return false;
    }
}

export async function syncRisuAi(config) {
    if (!config.risuAiSync?.enabled) return;
    
    log.info('Starting RisuAI sync...');
    loadBlacklist();

    let page = 1;
    let hasMore = true;
    const limit = config.risuAiSync?.pageLimit || 5;

    while (hasMore && page <= limit) {
        try {
            log.info(`Fetching RisuAI list page ${page}`);
            const listUrl = `${BASE_URL}/?sort=latest&page=${page}`;
            const response = await rateLimitedRequest(listUrl);
            const $ = cheerioLoad(response.data);
            
            const cardLinks = [];
            $('a[href^="/character/"]').each((i, el) => {
                cardLinks.push($(el).attr('href'));
            });

            if (cardLinks.length === 0) {
                hasMore = false;
                break;
            }

            for (const link of cardLinks) {
                await processRisuCard(link);
            }

            page++;
        } catch (error) {
            log.error(`Error syncing RisuAI page ${page}`, error);
            hasMore = false;
        }
    }
    
    log.info('RisuAI sync complete.');
}
