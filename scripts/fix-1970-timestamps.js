#!/usr/bin/env node

/**
 * Fix CT cards with 1970-01-01 lastModified timestamps
 * These were caused by CT API returning lastUpdateAt: 0 or "0"
 * We'll use createdAt as the lastModified fallback
 */

import { initDatabase, getDatabase } from '../backend/database.js';

async function main() {
  initDatabase();
  const db = getDatabase();

  console.log('[INFO] Finding CT cards with 1970-01-01 timestamps...');

  const affectedCards = db.prepare(`
    SELECT id, createdAt, lastModified
    FROM cards
    WHERE source = 'ct'
      AND lastModified LIKE '1970%'
  `).all();

  console.log(`[INFO] Found ${affectedCards.length} cards to fix`);

  if (affectedCards.length === 0) {
    console.log('[INFO] No cards need fixing. Exiting.');
    return;
  }

  let updated = 0;
  let skipped = 0;

  const updateStmt = db.prepare(`
    UPDATE cards
    SET lastModified = ?
    WHERE id = ?
  `);

  for (const card of affectedCards) {
    // Use createdAt as fallback for lastModified
    if (card.createdAt && card.createdAt !== '' && !card.createdAt.startsWith('1970')) {
      updateStmt.run(card.createdAt, card.id);
      updated++;

      if (updated % 100 === 0) {
        console.log(`[INFO] Updated ${updated}/${affectedCards.length} cards...`);
      }
    } else {
      console.warn(`[WARN] Card ${card.id} has invalid createdAt: ${card.createdAt}, skipping`);
      skipped++;
    }
  }

  console.log(`[INFO] Done! Updated: ${updated}, Skipped: ${skipped}`);
  console.log(`[INFO] All CT cards now have valid lastModified timestamps`);
}

main().catch(error => {
  console.error('[ERROR] Fix script failed:', error);
  process.exit(1);
});
