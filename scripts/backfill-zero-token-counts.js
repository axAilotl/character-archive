import { initDatabase, getDatabase } from '../backend/database.js';
import { resolveTokenCountsFromMetadata } from '../backend/utils/token-counts.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.join(__dirname, '..', 'static');

function readMetadataFile(cardId) {
    const cardIdStr = String(cardId);
    const subfolder = path.join(STATIC_DIR, cardIdStr.substring(0, 2));
    const jsonPath = path.join(subfolder, `${cardIdStr}.json`);

    if (!fs.existsSync(jsonPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`[ERROR] Failed to read metadata for ${cardId}:`, error.message);
        return null;
    }
}

async function backfillZeroTokenCounts() {
    await initDatabase();
    const db = getDatabase();

    // Find all Chub cards with all zero token counts
    const query = `
        SELECT id, name
        FROM cards
        WHERE source = 'chub'
        AND tokenDescriptionCount = 0
        AND tokenPersonalityCount = 0
        AND tokenScenarioCount = 0
        AND tokenMesExampleCount = 0
        AND tokenFirstMessageCount = 0
        AND tokenSystemPromptCount = 0
        AND tokenPostHistoryCount = 0
    `;

    const cards = db.prepare(query).all();
    console.log(`[INFO] Found ${cards.length} cards with all zero token counts`);

    if (cards.length === 0) {
        console.log('[INFO] No cards to backfill');
        return;
    }

    const updateStmt = db.prepare(`
        UPDATE cards
        SET tokenDescriptionCount = ?,
            tokenPersonalityCount = ?,
            tokenScenarioCount = ?,
            tokenMesExampleCount = ?,
            tokenFirstMessageCount = ?,
            tokenSystemPromptCount = ?,
            tokenPostHistoryCount = ?
        WHERE id = ?
    `);

    let updated = 0;
    let skipped = 0;
    let noMetadata = 0;

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        if (i % 100 === 0) {
            console.log(`[PROGRESS] Processing ${i}/${cards.length} (updated: ${updated}, skipped: ${skipped}, no metadata: ${noMetadata})`);
        }

        const metadata = readMetadataFile(card.id);
        if (!metadata) {
            noMetadata++;
            continue;
        }

        const counts = resolveTokenCountsFromMetadata(metadata);
        if (!counts) {
            skipped++;
            continue;
        }

        // Check if counts are actually non-zero (some cards might legitimately have 0 counts)
        const hasNonZero = Object.values(counts).some(v => v > 0);
        if (!hasNonZero) {
            skipped++;
            continue;
        }

        updateStmt.run(
            counts.tokenDescriptionCount ?? 0,
            counts.tokenPersonalityCount ?? 0,
            counts.tokenScenarioCount ?? 0,
            counts.tokenMesExampleCount ?? 0,
            counts.tokenFirstMessageCount ?? 0,
            counts.tokenSystemPromptCount ?? 0,
            counts.tokenPostHistoryCount ?? 0,
            card.id
        );
        updated++;
    }

    console.log(`[INFO] Backfill complete:`);
    console.log(`  - Updated: ${updated} cards`);
    console.log(`  - Skipped (no counts in metadata): ${skipped} cards`);
    console.log(`  - No metadata file: ${noMetadata} cards`);
}

backfillZeroTokenCounts().catch(error => {
    console.error('[ERROR] Backfill failed:', error);
    process.exit(1);
});
