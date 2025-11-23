import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const STATIC_DIR = path.join(__dirname, '../../static');

export function getCardFilePaths(cardId) {
    const cardIdStr = String(cardId);
    const subfolder = path.join(STATIC_DIR, cardIdStr.substring(0, 2));
    return {
        subfolder,
        jsonPath: path.join(subfolder, `${cardIdStr}.json`),
        pngPath: path.join(subfolder, `${cardIdStr}.png`)
    };
}

export function readCardPngSpec(cardId) {
    const { pngPath } = getCardFilePaths(cardId);
    if (!fs.existsSync(pngPath)) {
        return null;
    }
    const pngData = fs.readFileSync(pngPath);
    let offset = 8;
    while (offset < pngData.length) {
        const length = pngData.readUInt32BE(offset);
        const chunkType = pngData.toString('ascii', offset + 4, offset + 8);
        const chunkData = pngData.slice(offset + 8, offset + 8 + length);
        if (chunkType === 'tEXt') {
            const nullIndex = chunkData.indexOf(0);
            if (nullIndex > 0) {
                const keyword = chunkData.toString('latin1', 0, nullIndex);
                if (keyword.toLowerCase() === 'chara') {
                    const text = chunkData.slice(nullIndex + 1);
                    const decoded = Buffer.from(text.toString(), 'base64').toString('utf8');
                    try {
                        return JSON.parse(decoded);
                    } catch (error) {
                        console.warn('[WARN] Failed to parse embedded PNG spec:', error?.message || error);
                        return null;
                    }
                }
            }
        }
        offset += 12 + length;
    }
    return null;
}

export function hasEmbeddedImages(text) {
    if (!text || typeof text !== 'string') {
        return false;
    }
    // Check for Markdown images: ![alt](url)
    if (/!\[([^\]]*)\]\(([^)]+)\)/.test(text)) {
        return true;
    }
    // Check for HTML images: <img src="...">
    if (/<img[^>]+src=["']([^"']+)["'][^>]*>/i.test(text)) {
        return true;
    }
    return false;
}

export function deriveFeatureFlagsFromSpec(specData = {}) {
    const flags = {};
    try {
        const data = specData.data || specData;
        if (data) {
            if (Array.isArray(data.alternate_greetings)) {
                flags.hasAlternateGreetings = data.alternate_greetings.some(g => typeof g === 'string' && g.trim().length > 0);
            }
            if (typeof data.mes_example === 'string') {
                flags.hasExampleDialogues = data.mes_example.trim().length > 0;
            }
            if (typeof data.system_prompt === 'string') {
                flags.hasSystemPrompt = data.system_prompt.trim().length > 0;
            }
            const book = data.character_book;
            if (book && Array.isArray(book.entries)) {
                const entries = book.entries;
                flags.hasLorebook = entries.length > 0;
                const embeddedEntry = entries.find(entry => entry?.extensions?.embedded);
                const linkedEntry = entries.find(entry => entry?.extensions?.linked);
                flags.hasEmbeddedLorebook = Boolean(embeddedEntry);
                flags.hasLinkedLorebook = Boolean(linkedEntry);
            }
            const extensions = data.extensions;
            if (extensions?.gallery && Array.isArray(extensions.gallery)) {
                flags.hasGallery = extensions.gallery.length > 0;
            }

            // Check for embedded images in greetings
            let hasImages = false;
            if (data.first_mes && hasEmbeddedImages(data.first_mes)) {
                hasImages = true;
            } else if (Array.isArray(data.alternate_greetings)) {
                hasImages = data.alternate_greetings.some(g => typeof g === 'string' && hasEmbeddedImages(g));
            }
            flags.hasEmbeddedImages = hasImages;
        }
    } catch (error) {
        console.warn('[WARN] Failed to derive feature flags from spec:', error?.message || error);
    }
    return flags;
}
