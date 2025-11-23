#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

import { initDatabase, getDatabase, detectLanguage } from '../backend/database.js';
import { isCtBlacklisted } from '../backend/utils/ct-blacklist.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const STATIC_DIR = path.join(ROOT_DIR, 'static');
const METADATA_DIR = path.join(ROOT_DIR, 'static', 'ct', 'metadata', 'new');

const CT_CF_CLEARANCE = process.env.CT_CF_CLEARANCE || '';
const CT_SESSION = process.env.CT_SESSION || '';
const CT_ALLOWED_WARNINGS = process.env.CT_ALLOWED_WARNINGS || '';

const REQUEST_HEADERS = {
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Referer: 'https://character-tavern.com/',
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    return new Date().toISOString().replace('T', ' ').split('.')[0];
  }
  const normalized = normalizeEpoch(value);
  const date = typeof normalized === 'number' ? new Date(normalized) : new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace('T', ' ').split('.')[0];
  }
  return date.toISOString().replace('T', ' ').split('.')[0];
}

function collapseExamples(examples) {
  if (!examples) return '';
  if (typeof examples === 'string') return examples;
  if (Array.isArray(examples)) {
    return examples
      .map(entry => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') {
          const text = entry.example || entry.text || entry.message;
          if (text) return text;
          try {
            return JSON.stringify(entry);
          } catch {
            return '';
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof examples === 'object') {
    try {
      return JSON.stringify(examples);
    } catch {
      return '';
    }
  }
  return '';
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map(tag => (tag || '').toString().trim()).filter(Boolean)));
}

function formatDescription(hit) {
  return (
    hit.characterDefinition ||
    hit.pageDescription ||
    hit.characterScenario ||
    ''
  );
}

function hasAlternateGreetings(hit) {
  return Array.isArray(hit.alternativeFirstMessage) && hit.alternativeFirstMessage.some(msg => typeof msg === 'string' && msg.trim().length > 0);
}

function hasExampleDialogues(hit) {
  if (!hit.characterExampleMessages) return false;
  if (typeof hit.characterExampleMessages === 'string') {
    return hit.characterExampleMessages.trim().length > 0;
  }
  if (Array.isArray(hit.characterExampleMessages)) {
    return hit.characterExampleMessages.length > 0;
  }
  return false;
}

async function downloadCardImage(cardPath) {
  const url = `https://cards.character-tavern.com/${cardPath}.png?action=download`;
  const headers = { ...REQUEST_HEADERS };
  const cookies = [];
  if (CT_CF_CLEARANCE) cookies.push(`cf_clearance=${CT_CF_CLEARANCE.trim()}`);
  if (CT_SESSION) cookies.push(`session=${CT_SESSION.trim()}`);
  if (CT_ALLOWED_WARNINGS) cookies.push(`content_warnings=${CT_ALLOWED_WARNINGS.trim()}`);
  if (cookies.length) {
    headers.Cookie = cookies.join('; ');
  }
  const response = await axios.get(url, { responseType: 'arraybuffer', headers });
  return Buffer.from(response.data);
}

function ensureFolderForCardId(cardId) {
  const cardIdStr = String(cardId);
  const subfolder = path.join(STATIC_DIR, cardIdStr.substring(0, 2));
  fs.mkdirSync(subfolder, { recursive: true });
  return subfolder;
}

function buildMetadataPayload(cardId, hit, description, tags, flags, sourceUrl, createdAtSql, lastUpdateSql) {
  return {
    id: cardId,
    source: 'ct',
    source_id: hit.id,
    path: hit.path,
    fullPath: hit.path,
    name: hit.name || hit.inChatName || 'Untitled',
    author: hit.author || '',
    description,
    tagline: hit.tagline || '',
    tags,
    alternate_greetings: Array.isArray(hit.alternativeFirstMessage) ? hit.alternativeFirstMessage : [],
    mes_example: collapseExamples(hit.characterExampleMessages),
    system_prompt: hit.characterPostHistoryPrompt || '',
    character_book: null,
    related_lorebooks: [],
    extensions: {},
    hasAlternateGreetings: flags.hasAlternateGreetings,
    hasExampleDialogues: flags.hasExampleDialogues,
    hasSystemPrompt: flags.hasSystemPrompt,
    hasLorebook: flags.hasLorebook,
    hasEmbeddedLorebook: false,
    hasLinkedLorebook: false,
    hasGallery: false,
    createdAt: createdAtSql,
    lastUpdateAt: lastUpdateSql,
    createdAtRaw: hit.createdAt || hit.created_at || null,
    lastUpdateAtRaw: hit.lastUpdateAt || hit.updatedAt || hit.updated_at || null,
    importedAt: new Date().toISOString(),
    sourceUrl,
    rawHit: hit,
  };
}

async function insertCard(db, payload) {
  const columns = [
    'author', 'name', 'tagline', 'description', 'topics', 'tokenCount',
    'tokenDescriptionCount', 'tokenPersonalityCount', 'tokenScenarioCount',
    'tokenMesExampleCount', 'tokenFirstMessageCount', 'tokenSystemPromptCount',
    'tokenPostHistoryCount',
    'lastModified', 'createdAt', 'nChats', 'nMessages', 'n_favorites',
    'starCount', 'ratingsEnabled', 'rating', 'ratingCount', 'ratings',
    'fullPath', 'favorited', 'language', 'visibility', 'hasAlternateGreetings', 'hasLorebook',
    'hasEmbeddedLorebook', 'hasLinkedLorebook', 'hasExampleDialogues', 'hasSystemPrompt', 'hasGallery',
    'source', 'sourceId', 'sourcePath', 'sourceUrl'
  ];
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO cards (${columns.join(', ')}) VALUES (${placeholders})`;

  const result = db.prepare(sql).run(
    payload.author,
    payload.name,
    payload.tagline,
    payload.description,
    payload.topics,
    payload.tokenCount,
    payload.tokenDescriptionCount,
    payload.tokenPersonalityCount,
    payload.tokenScenarioCount,
    payload.tokenMesExampleCount,
    payload.tokenFirstMessageCount,
    payload.tokenSystemPromptCount,
    payload.tokenPostHistoryCount,
    payload.lastModified,
    payload.createdAt,
    payload.nChats,
    payload.nMessages,
    payload.nFavorites,
    payload.starCount,
    payload.ratingsEnabled,
    payload.rating,
    payload.ratingCount,
    payload.ratings,
    payload.fullPath,
    payload.favorited,
    payload.language,
    payload.visibility,
    payload.hasAlternateGreetings,
    payload.hasLorebook,
    payload.hasEmbeddedLorebook,
    payload.hasLinkedLorebook,
    payload.hasExampleDialogues,
    payload.hasSystemPrompt,
    payload.hasGallery,
    payload.source,
    payload.sourceId,
    payload.sourcePath,
    payload.sourceUrl,
  );

  return result.lastInsertRowid;
}

async function main() {
  console.log('[INFO] Importing Character Tavern cards from metadata cache...');
  if (!fs.existsSync(METADATA_DIR)) {
    console.error(`[ERROR] Metadata directory not found: ${METADATA_DIR}`);
    process.exit(1);
  }

  await initDatabase();
  const db = getDatabase();
  db.prepare('PRAGMA foreign_keys = ON').run();

  const files = fs
    .readdirSync(METADATA_DIR)
    .filter(file => file.endsWith('.json'))
    .sort();

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(METADATA_DIR, file);
    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      console.error(`[ERROR] Failed to read metadata ${file}:`, error.message);
      failed += 1;
      continue;
    }

    const hit = metadata.hit;
    if (!hit) {
      skipped += 1;
      continue;
    }

    try {
      if (isCtBlacklisted(hit.id)) {
        skipped += 1;
        continue;
      }

      const existing = db.prepare('SELECT id FROM cards WHERE source = ? AND sourceId = ?').get('ct', hit.id);
      if (existing) {
        skipped += 1;
        continue;
      }

      const description = formatDescription(hit);
      const tags = sanitizeTags(hit.tags || []);
      const language = detectLanguage(description || hit.tagline || hit.characterFirstMessage || '');
      const flags = {
        hasAlternateGreetings: hasAlternateGreetings(hit),
        hasExampleDialogues: hasExampleDialogues(hit),
        hasSystemPrompt: !!(hit.characterPostHistoryPrompt && hit.characterPostHistoryPrompt.trim().length > 0),
        hasLorebook: false,
        hasEmbeddedLorebook: false,
        hasLinkedLorebook: false,
      };

      const tokenCount = hit.totalTokens || 0;
      const nFavorites = hit.likes || 0;
      const starCount = hit.downloads || 0;
      const nMessages = hit.messages || 0;
      const nChats = hit.views || 0;
      const ctPath = (hit.path || '').trim().replace(/^\/+/, '');
      const sourceUrl = `https://character-tavern.com/character/${ctPath || hit.id}`;
      const createdAtSql = toSqlTimestamp(hit.createdAt || hit.created_at);
      const lastUpdateSql = toSqlTimestamp(hit.lastUpdateAt || hit.updatedAt || hit.updated_at || hit.createdAt);

      const payload = {
        author: hit.author || '',
        name: hit.name || hit.inChatName || 'Untitled',
        tagline: hit.tagline || '',
        description,
        topics: tags.join(','),
        tokenCount,
        tokenDescriptionCount: null,
        tokenPersonalityCount: null,
        tokenScenarioCount: null,
        tokenMesExampleCount: null,
        tokenFirstMessageCount: null,
        tokenSystemPromptCount: null,
        tokenPostHistoryCount: null,
        lastModified: lastUpdateSql,
        createdAt: createdAtSql,
        nChats,
        nMessages,
        nFavorites,
        starCount,
        ratingsEnabled: 0,
        rating: 0,
        ratingCount: 0,
        ratings: '{}',
        fullPath: hit.path || '',
        favorited: 0,
        language,
        visibility: 'public',
        hasAlternateGreetings: flags.hasAlternateGreetings ? 1 : 0,
        hasLorebook: flags.hasLorebook ? 1 : 0,
        hasEmbeddedLorebook: 0,
        hasLinkedLorebook: 0,
        hasExampleDialogues: flags.hasExampleDialogues ? 1 : 0,
        hasSystemPrompt: flags.hasSystemPrompt ? 1 : 0,
        hasGallery: 0,
        source: 'ct',
        sourceId: hit.id,
        sourcePath: hit.path || '',
        sourceUrl,
      };

      const imageBuffer = await downloadCardImage(hit.path);
      const newId = await insertCard(db, payload);
      const folder = ensureFolderForCardId(newId);
      const cardIdStr = String(newId);
      fs.writeFileSync(path.join(folder, `${cardIdStr}.png`), imageBuffer);

      const metadataPayload = buildMetadataPayload(newId, hit, description, tags, {
        hasAlternateGreetings: !!payload.hasAlternateGreetings,
        hasExampleDialogues: !!payload.hasExampleDialogues,
        hasSystemPrompt: !!payload.hasSystemPrompt,
        hasLorebook: !!payload.hasLorebook,
      }, sourceUrl, createdAtSql, lastUpdateSql);
      fs.writeFileSync(path.join(folder, `${cardIdStr}.json`), JSON.stringify(metadataPayload, null, 2));

      inserted += 1;
      if (inserted % 50 === 0) {
        console.log(`[INFO] Imported ${inserted} cards so far...`);
      }
      await sleep(150);
    } catch (error) {
      console.error(`[ERROR] Failed to import ${hit.name || hit.path}:`, error.message);
      failed += 1;
    }
  }

  console.log(`[INFO] Import complete. Inserted: ${inserted}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(error => {
  console.error('[ERROR] Import script failed:', error);
  process.exit(1);
});
