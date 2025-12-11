#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDatabase, getDatabase } from '../backend/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const STATIC_DIR = path.join(ROOT_DIR, 'static');

function normalizeEpoch(value) {
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num < 1e12 ? num * 1000 : num;
    }
  }
  return value;
}

function toSqlTimestamp(value) {
  if (!value) {
    return null;
  }
  const normalized = normalizeEpoch(value);
  const date = typeof normalized === 'number' ? new Date(normalized) : new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().replace('T', ' ').split('.')[0];
}

async function main() {
  await initDatabase();
  const db = getDatabase();
  db.prepare('PRAGMA foreign_keys = ON').run();

  const rows = db.prepare("SELECT id FROM cards WHERE source = 'ct'").all();
  console.log(`[INFO] Found ${rows.length} CT cards to inspect`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const cardId = String(row.id);
    const subfolder = path.join(STATIC_DIR, cardId.substring(0, 2));
    const jsonPath = path.join(subfolder, `${cardId}.json`);

    if (!fs.existsSync(jsonPath)) {
      skipped += 1;
      continue;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const rawHit = metadata.rawHit || metadata.hit || null;

      const createdCandidates = [
        metadata.createdAtRaw,
        rawHit?.createdAt,
        rawHit?.created_at,
        metadata.createdAt,
      ];
      const updatedCandidates = [
        metadata.lastModified,
        metadata.lastActivityAt,
        metadata.lastUpdateAtRaw,
        rawHit?.lastUpdateAt,
        rawHit?.updatedAt,
        rawHit?.updated_at,
        metadata.lastUpdateAt,
        createdCandidates.find(v => v !== undefined && v !== null && v !== ''),
      ];

      const createdRaw = createdCandidates.find(v => v !== undefined && v !== null && v !== '');
      const updatedRaw = updatedCandidates.find(v => v !== undefined && v !== null && v !== '');

      const createdSql = toSqlTimestamp(createdRaw);
      const updatedSql = toSqlTimestamp(updatedRaw) || createdSql;

      if (!createdSql) {
        skipped += 1;
        continue;
      }

      db.prepare('UPDATE cards SET createdAt = ?, lastModified = ? WHERE id = ?').run(createdSql, updatedSql || createdSql, cardId);
      metadata.createdAt = createdSql;
      metadata.lastUpdateAt = updatedSql || createdSql;
      metadata.createdAtRaw = createdRaw ?? null;
      metadata.lastUpdateAtRaw = updatedRaw ?? null;

      fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
      updated += 1;
      if (updated % 100 === 0) {
        console.log(`[INFO] Updated ${updated} cards...`);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to update CT card ${cardId}:`, error.message);
      errors += 1;
    }
  }

  console.log(`[INFO] Done. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

main().catch(error => {
  console.error('[ERROR] Fix script failed:', error);
  process.exit(1);
});
