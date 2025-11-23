#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getDatabase, upsertCard } from '../backend/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.join(__dirname, '..', 'static');

async function updateAllMetadata() {
    console.log('[INFO] Starting metadata update for all cards...');
    await initDatabase();
    
    const db = getDatabase();
    const allCards = db.prepare('SELECT id FROM cards').all();
    
    let updated = 0;
    let errors = 0;
    
    for (const row of allCards) {
        const cardId = String(row.id);
        const subfolder = path.join(STATIC_DIR, cardId.substring(0, 2));
        const jsonPath = path.join(subfolder, `${cardId}.json`);
        
        if (!fs.existsSync(jsonPath)) {
            console.warn(`[WARNING] No JSON found for card ${cardId}, skipping`);
            errors++;
            continue;
        }
        
        try {
            const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            
            // Re-detect all boolean flags from metadata
            let hasAlternateGreetings = false;
            let hasEmbeddedLorebook = false;
            let hasLinkedLorebook = false;
            let hasExampleDialogues = false;
            let hasSystemPrompt = false;
            let hasGallery = false;
            
            // Check for alternate greetings
            if (Array.isArray(metadata.alternate_greetings)) {
                hasAlternateGreetings = metadata.alternate_greetings.some(
                    g => typeof g === 'string' && g.trim().length > 0
                );
            }
            
            // Check for embedded lorebook
            const lorebookEntries = metadata.character_book?.entries;
            if (Array.isArray(lorebookEntries) && lorebookEntries.length > 0) {
                hasEmbeddedLorebook = true;
            }
            
            // Check for linked lorebooks
            if (Array.isArray(metadata.related_lorebooks) && metadata.related_lorebooks.length > 0) {
                hasLinkedLorebook = true;
            }
            
            // Check for example dialogues
            if (typeof metadata.mes_example === 'string' && metadata.mes_example.trim().length > 0) {
                hasExampleDialogues = true;
            }
            
            // Check for system prompt
            if (typeof metadata.system_prompt === 'string' && metadata.system_prompt.trim().length > 0) {
                hasSystemPrompt = true;
            }
            
            // Check for gallery
            if (metadata.extensions?.gallery && Array.isArray(metadata.extensions.gallery) && metadata.extensions.gallery.length > 0) {
                hasGallery = true;
            }

            if (!hasGallery) {
                try {
                    const cachedGallery = db.prepare(
                        'SELECT COUNT(*) as count FROM cached_assets WHERE cardId = ? AND assetType = ?'
                    ).get(cardId, 'gallery');
                    if (cachedGallery?.count > 0) {
                        hasGallery = true;
                    }
                } catch (galleryError) {
                    console.warn(`[WARNING] Failed to inspect cached gallery for ${cardId}:`, galleryError.message);
                }
            }
            
            // Update metadata flags
            metadata.hasAlternateGreetings = hasAlternateGreetings;
            metadata.hasEmbeddedLorebook = hasEmbeddedLorebook;
            metadata.hasLinkedLorebook = hasLinkedLorebook;
            metadata.hasLorebook = hasEmbeddedLorebook || hasLinkedLorebook;
            metadata.hasExampleDialogues = hasExampleDialogues;
            metadata.hasSystemPrompt = hasSystemPrompt;
            metadata.hasGallery = hasGallery;
            
            // Save updated metadata
            fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 4));
            await upsertCard(metadata);
            
            updated++;
            if (updated % 100 === 0) {
                console.log(`[INFO] Updated ${updated}/${allCards.length} cards...`);
            }
        } catch (error) {
            console.error(`[ERROR] Failed to update card ${cardId}:`, error.message);
            errors++;
        }
    }
    
    console.log(`[INFO] Metadata update complete. Updated: ${updated}, Errors: ${errors}`);
    process.exit(0);
}

updateAllMetadata().catch(err => {
    console.error('[ERROR] Update failed:', err);
    process.exit(1);
});

