import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getDatabase, detectLanguage } from '../database.js';
import { isCtBlacklisted } from '../utils/ct-blacklist.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('CT-SYNC');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.join(__dirname, '../../static');

const SEARCH_URL = 'https://search.character-tavern.com/indexes/characters/search';
const CARDS_BASE_URL = 'https://cards.character-tavern.com';
const DEFAULT_MIN_TOKENS = 300;
const DEFAULT_MAX_TOKENS = 900000;
const DEFAULT_HITS_PER_PAGE = 49;
const DEFAULT_SORT = ['createdAt:desc'];
const REQUEST_HEADERS = {
  accept: '*/*',
  'content-type': 'application/json',
  dnt: '1',
  origin: 'https://character-tavern.com',
  referer: 'https://character-tavern.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'x-meilisearch-client': 'CharacterTavernSync (node)',
};

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
  // Treat 0 or "0" as missing/invalid timestamp
  if (!value || value === 0 || value === '0') {
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
  return hit.characterDefinition || hit.pageDescription || hit.characterScenario || '';
}

function hasAlternateGreetings(hit) {
  return (
    Array.isArray(hit.alternativeFirstMessage) && hit.alternativeFirstMessage.some(msg => typeof msg === 'string' && msg.trim().length > 0)
  );
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

async function downloadCtImage(cardPath, cookies) {
  const url = `${CARDS_BASE_URL}/${cardPath}.png?action=download`;
  const headers = {
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    referer: 'https://character-tavern.com/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };
  if (cookies?.length) {
    headers.Cookie = cookies.join('; ');
  }
  const response = await axios.get(url, { responseType: 'arraybuffer', headers, timeout: 30000 });
  return Buffer.from(response.data);
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

async function fetchCtPage({ bearerToken, hitsPerPage, page, minTokens, maxTokens, excludedWarnings }) {
  const filters = [`totalTokens >= ${minTokens}`, `totalTokens <= ${maxTokens}`];
  if (excludedWarnings && excludedWarnings.length > 0) {
    const warnings = excludedWarnings.map(w => `\"${w}\"`).join(',');
    filters.push(`(contentWarnings IS EMPTY OR contentWarnings NOT IN [${warnings}])`);
  } else {
    filters.push('(contentWarnings IS EMPTY OR contentWarnings NOT IN [])');
  }
  const body = {
    q: '',
    hitsPerPage,
    sort: DEFAULT_SORT,
    filter: filters,
    page,
  };

  const headers = {
    ...REQUEST_HEADERS,
    authorization: `Bearer ${bearerToken}`,
  };

  const response = await axios.post(SEARCH_URL, body, { headers, timeout: 30000 });
  const payload = response.data;
  return {
    hits: payload?.hits || [],
    totalPages: payload?.totalPages || payload?.totalPagesCount || null,
  };
}

function matchesBannedTags(hit, bannedLower) {
  if (!bannedLower.length) return false;
  const tagSet = new Set((hit.tags || []).map(tag => tag.toLowerCase()));
  return bannedLower.some(tag => tagSet.has(tag));
}

export async function syncCharacterTavern(appConfig = {}, progressCallback = null) {
  const ctConfig = appConfig.ctSync || {};
  if (!ctConfig.enabled) {
    return { added: 0, skipped: 0, processed: 0 };
  }

  const bearerToken = ctConfig.bearerToken || process.env.CT_SEARCH_BEARER;
  if (!bearerToken) {
    throw new Error('Character Tavern bearer token missing (set ctSync.bearerToken or CT_SEARCH_BEARER)');
  }

  const hitsPerPage = Math.min(ctConfig.hitsPerPage || DEFAULT_HITS_PER_PAGE, DEFAULT_HITS_PER_PAGE);
  const maxPages = Math.max(1, ctConfig.pages || 1);
  const minTokens = ctConfig.minTokens || DEFAULT_MIN_TOKENS;
  const maxTokens = ctConfig.maxTokens || DEFAULT_MAX_TOKENS;
  const excludedWarnings = ctConfig.excludedWarnings || [];
  const bannedTags = (ctConfig.bannedTags || []).map(tag => tag.toLowerCase());
  const cookies = [];
  if (ctConfig.cfClearance || process.env.CT_CF_CLEARANCE) cookies.push(`cf_clearance=${(ctConfig.cfClearance || process.env.CT_CF_CLEARANCE).trim()}`);
  if (ctConfig.session || process.env.CT_SESSION) cookies.push(`session=${(ctConfig.session || process.env.CT_SESSION).trim()}`);
  if (ctConfig.allowedWarnings || process.env.CT_ALLOWED_WARNINGS) {
    cookies.push(`content_warnings=${(ctConfig.allowedWarnings || process.env.CT_ALLOWED_WARNINGS).trim()}`);
  }

  const db = getDatabase();
  db.prepare('PRAGMA foreign_keys = ON').run();

  let added = 0;
  let skipped = 0;
  let processed = 0;

  for (let page = 1; page <= maxPages; page++) {
    let pagePayload;
    try {
      pagePayload = await fetchCtPage({
        bearerToken,
        hitsPerPage,
        page,
        minTokens,
        maxTokens,
        excludedWarnings,
      });
    } catch (error) {
      if (error?.response?.status === 403) {
        throw new Error('Character Tavern search returned 403 (check bearer token / Cloudflare cookie)');
      }
      throw error;
    }

    const hits = pagePayload.hits || [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      processed += 1;

      if (hit.totalTokens && hit.totalTokens < minTokens) {
        skipped += 1;
        continue;
      }

      if (matchesBannedTags(hit, bannedTags)) {
        skipped += 1;
        continue;
      }

      if (isCtBlacklisted(hit.id)) {
        skipped += 1;
        continue;
      }

      const existing = db.prepare('SELECT id FROM cards WHERE source = ? AND sourceId = ?').get('ct', hit.id);
      if (existing) {
        skipped += 1;
        continue;
      }

      try {
        const description = formatDescription(hit);
        const tags = sanitizeTags(hit.tags || []);
        const language = detectLanguage(description || hit.tagline || hit.characterFirstMessage || '');
        const flags = {
          hasAlternateGreetings: hasAlternateGreetings(hit),
          hasExampleDialogues: hasExampleDialogues(hit),
          hasSystemPrompt: !!(hit.characterPostHistoryPrompt && hit.characterPostHistoryPrompt.trim().length > 0),
          hasLorebook: false,
        };
        const tokenCount = hit.totalTokens || 0;
        const nFavorites = hit.likes || 0;
        const starCount = hit.downloads || 0;
        const nMessages = hit.messages || 0;
        const nChats = hit.views || 0;
        const ctPath = (hit.path || '').trim().replace(/^\/+/, '');
        const sourceUrl = `https://character-tavern.com/character/${ctPath || hit.id}`;
        const createdAtRaw = hit.createdAt || hit.created_at;
        const lastUpdateAtRaw = hit.lastUpdateAt || hit.updatedAt || hit.updated_at;

        // Treat 0 or "0" as missing timestamp - use createdAt as fallback for lastUpdate
        const createdAtSql = toSqlTimestamp(createdAtRaw);
        const lastUpdateSql = toSqlTimestamp(
          (lastUpdateAtRaw === 0 || lastUpdateAtRaw === '0') ? createdAtRaw : (lastUpdateAtRaw || createdAtRaw)
        );

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

        const imageBuffer = await downloadCtImage(hit.path, cookies);
        const newId = await insertCard(db, payload);
        const folder = ensureFolderForCardId(newId);
        const cardIdStr = String(newId);
        fs.writeFileSync(path.join(folder, `${cardIdStr}.png`), imageBuffer);
        const metadataPayload = buildMetadataPayload(
          newId,
          hit,
          description,
          tags,
          {
            hasAlternateGreetings: !!payload.hasAlternateGreetings,
            hasExampleDialogues: !!payload.hasExampleDialogues,
            hasSystemPrompt: !!payload.hasSystemPrompt,
            hasLorebook: !!payload.hasLorebook,
          },
          sourceUrl,
          createdAtSql,
          lastUpdateSql,
        );
        fs.writeFileSync(path.join(folder, `${cardIdStr}.json`), JSON.stringify(metadataPayload, null, 2));
        added += 1;
      } catch (error) {
        log.error(`Failed to import CT card ${hit?.name || hit?.path || hit?.id}`, error);
        skipped += 1;
      }

      if (progressCallback) {
        progressCallback({ page, processed, added, skipped });
      }
    }

    if (pagePayload.totalPages && page >= pagePayload.totalPages) {
      break;
    }
  }

  return { added, skipped, processed };
}
