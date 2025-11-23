#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { initDatabase, getDatabase } from '../backend/database.js';
import { loadConfig } from '../config.js';
import { readCardPngSpec, getCardFilePaths } from '../backend/utils/card-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = loadConfig();
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || config.vectorSearch?.ollamaUrl || 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || config.vectorSearch?.embedModel || 'snowflake-arctic-embed2:latest';
const EMBEDDER_NAME = process.env.MEILI_EMBEDDER || config.vectorSearch?.embedderName || 'arctic2-1024';
const CHUNK_TOKEN_THRESHOLD = Number(process.env.CHUNK_TOKEN_THRESHOLD || 300);
const CHUNK_TARGET_CHARS = Number(process.env.CHUNK_CHAR_TARGET || 1200);
const CHUNK_CHAR_OVERLAP = Number(process.env.CHUNK_CHAR_OVERLAP || 300);
const CARD_QUERY_PAGE_SIZE = Number(process.env.CARD_QUERY_PAGE_SIZE || 100);
const LOG_EVERY = Number(process.env.LOG_EVERY || 25);
const CARD_LIMIT = process.env.LCR_VECTOR_LIMIT ? Number(process.env.LCR_VECTOR_LIMIT) : null;
const START_AFTER = process.env.LCR_VECTOR_START_AFTER ? Number(process.env.LCR_VECTOR_START_AFTER) : null;
const FORCE_REEMBED = process.env.LCR_VECTOR_FORCE === '1';

// Support multiple Ollama instances via comma-separated URLs in config or env var
const SECONDARY_OLLAMA_URL = process.env.OLLAMA_URL_SECONDARY || config.vectorSearch?.ollamaUrlSecondary || null;
let OLLAMA_INSTANCES = [DEFAULT_OLLAMA_URL];
// Secondary instance will be added in main() if available

let ollamaRoundRobin = 0;
const MEILI_HOST = (process.env.MEILI_HOST || config.meilisearch.host || '').replace(/\/$/, '');
const MEILI_KEY = process.env.MEILI_KEY || config.meilisearch.apiKey || '';
const CARDS_INDEX = process.env.MEILI_CARDS_INDEX || 'cards_vsem';
const CHUNKS_INDEX = process.env.MEILI_CHUNKS_INDEX || 'card_chunks';
const DEBUG_DUMP_DIR = process.env.VECTOR_DEBUG_DIR || null;
let debugDocCounter = 0;

if (!MEILI_HOST || !MEILI_KEY) {
    console.error('[FATAL] Missing Meilisearch host or API key. Set MEILI_HOST/MEILI_KEY or config.meilisearch.');
    process.exit(1);
}

if (typeof fetch !== 'function') {
    console.error('[FATAL] Global fetch is unavailable. Run on Node.js 18+ or polyfill fetch.');
    process.exit(1);
}

const jsonHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${MEILI_KEY}`
};

const stats = {
    total: 0,
    processed: 0,
    skipped: 0,
    cardUpdates: 0,
    chunkUpdates: 0,
    chunkDeletes: 0
};

function approxTokenCount(text = '') {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

function normalizeText(input) {
    if (!input || typeof input !== 'string') {
        return '';
    }
    return input.replace(/\r\n/g, '\n').trim();
}

function sha256(text = '') {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function splitTopics(topics) {
    if (!topics) return [];
    if (Array.isArray(topics)) {
        return topics.map(t => t).filter(Boolean);
    }
    return String(topics)
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
}

function collectAlternateGreetings(specData = {}, metadata = {}) {
    const candidateArrays = [
        specData.alternate_greetings,
        metadata.alternate_greetings,
        metadata.definition?.data?.alternate_greetings,
        metadata.card_data?.alternate_greetings,
        metadata.cardData?.alternate_greetings
    ];
    const seen = new Set();
    const greetings = [];
    for (const candidate of candidateArrays) {
        if (!Array.isArray(candidate)) {
            continue;
        }
        for (const entry of candidate) {
            const normalized = normalizeText(entry);
            if (!normalized || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            greetings.push(normalized);
        }
    }
    return greetings;
}

function readMetadata(cardId) {
    const { jsonPath } = getCardFilePaths(cardId);
    if (!fs.existsSync(jsonPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (error) {
        console.warn(`[WARN] Failed to read metadata JSON for ${cardId}: ${error.message}`);
        return null;
    }
}

function splitIntoChunks(text, { target = CHUNK_TARGET_CHARS, overlap = CHUNK_CHAR_OVERLAP }) {
    const cleaned = normalizeText(text);
    if (!cleaned) {
        return [];
    }
    if (cleaned.length <= target) {
        return [{ text: cleaned, start: 0 }];
    }
    const chunks = [];
    let startIndex = 0;
    while (startIndex < cleaned.length) {
        const endIndex = Math.min(cleaned.length, startIndex + target);
        const slice = cleaned.slice(startIndex, endIndex);
        const trimmed = slice.trim();
        const chunkStartTokens = approxTokenCount(cleaned.slice(0, startIndex));
        chunks.push({ text: trimmed, start: chunkStartTokens });
        if (endIndex >= cleaned.length) {
            break;
        }
        startIndex = endIndex - overlap;
        if (startIndex < 0) {
            startIndex = 0;
        }
    }
    return chunks;
}

async function checkOllamaInstance(url) {
    try {
        const response = await fetch(`${url}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function embedBatch(texts) {
    if (!texts.length) {
        return [];
    }

    // Round-robin across available instances
    const ollamaUrl = OLLAMA_INSTANCES[ollamaRoundRobin % OLLAMA_INSTANCES.length];
    ollamaRoundRobin++;

    const body = JSON.stringify({ model: EMBED_MODEL, input: texts });
    const url = `${ollamaUrl}/api/embed`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[OLLAMA] ${response.status} ${response.statusText} — ${errorText}`);
    }
    const payload = await response.json();
    const vectors = payload?.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error('[OLLAMA] Embed response malformed or length mismatch');
    }
    return vectors;
}

async function embedBatchParallel(texts) {
    if (!texts.length) {
        return [];
    }

    // If only one instance, use normal batch
    if (OLLAMA_INSTANCES.length === 1) {
        return embedBatch(texts);
    }

    // Split texts across instances
    const chunkSize = Math.ceil(texts.length / OLLAMA_INSTANCES.length);
    const chunks = [];
    for (let i = 0; i < texts.length; i += chunkSize) {
        chunks.push(texts.slice(i, i + chunkSize));
    }

    // Embed in parallel across instances with retry and fallback
    const promises = chunks.map(async (chunk, idx) => {
        const ollamaUrl = OLLAMA_INSTANCES[idx % OLLAMA_INSTANCES.length];
        const body = JSON.stringify({ model: EMBED_MODEL, input: chunk });
        const url = `${ollamaUrl}/api/embed`;

        // Try with extended timeout (60s for large batches)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`[OLLAMA ${ollamaUrl}] ${response.status} ${response.statusText} — ${errorText}`);
            }
            const payload = await response.json();
            return payload?.embeddings || [];
        } catch (error) {
            // If secondary instance fails, fall back to primary for this chunk
            if (ollamaUrl !== DEFAULT_OLLAMA_URL) {
                console.warn(`[WARN] Secondary instance ${ollamaUrl} failed, falling back to primary for this batch: ${error.message}`);
                const fallbackUrl = `${DEFAULT_OLLAMA_URL}/api/embed`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000);

                const response = await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`[OLLAMA FALLBACK] ${response.status} ${response.statusText} — ${errorText}`);
                }
                const payload = await response.json();
                return payload?.embeddings || [];
            }
            throw error;
        }
    });

    const results = await Promise.all(promises);
    return results.flat();
}

async function meiliAddDocuments(indexUid, documents) {
    if (!documents.length) {
        return null;
    }
    if (DEBUG_DUMP_DIR && debugDocCounter < 10) {
        const dumpPath = path.join(DEBUG_DUMP_DIR, `meili-${indexUid}-${debugDocCounter}.json`);
        fs.mkdirSync(DEBUG_DUMP_DIR, { recursive: true });
        fs.writeFileSync(dumpPath, JSON.stringify(documents[0], null, 2));
        debugDocCounter += 1;
    }
    const url = `${MEILI_HOST}/indexes/${indexUid}/documents?primaryKey=id`;
    const response = await fetch(url, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(documents)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[MEILI] Failed to add documents to ${indexUid}: ${response.status} ${errorText}`);
    }
    const result = await response.json();

    // Fire and forget - don't wait for Meilisearch to index
    // Tasks will be processed asynchronously by Meilisearch
    return result;
}

async function meiliDeleteDocuments(indexUid, ids) {
    if (!ids.length) {
        return null;
    }
    const url = `${MEILI_HOST}/indexes/${indexUid}/documents/delete-batch`;
    const response = await fetch(url, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(ids)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[MEILI] Failed to delete documents from ${indexUid}: ${response.status} ${errorText}`);
    }
    return response.json();
}

async function handleCard(row, db) {
    const cardId = String(row.id);
    const spec = readCardPngSpec(cardId);
    const specData = spec?.data || {};
    const metadata = readMetadata(cardId) || {};

    const sectionSources = {
        description: specData.description ?? row.description ?? metadata.description ?? '',
        personality: specData.personality ?? metadata.personality ?? '',
        scenario: specData.scenario ?? metadata.scenario ?? '',
        first_mes: specData.first_mes ?? metadata.first_mes ?? ''
    };

    const baseSections = Object.entries(sectionSources)
        .map(([section, text]) => ({ section, text: normalizeText(text) }))
        .filter(item => item.text && item.text.length > 0);
    const altGreetings = collectAlternateGreetings(specData, metadata);
    if (!baseSections.length && altGreetings.length === 0) {
        stats.skipped += 1;
        console.warn(`[WARN] No usable text sections for card ${cardId}, skipping`);
        return;
    }

    const mesExample = normalizeText(specData.mes_example ?? metadata.mes_example ?? '');

    const tags = Array.isArray(specData.tags) && specData.tags.length
        ? specData.tags
        : splitTopics(row.topics || metadata.topics);

    const language = metadata.language || row.language || 'unknown';
    const creator = specData.creator || metadata.creator || row.author || '';
    const characterVersion = specData.character_version ?? metadata.character_version ?? null;
    const extensions = specData.extensions || metadata.extensions || null;

    const dataPayload = {
        name: specData.name || metadata.name || row.name || '',
        tagline: row.tagline || metadata.tagline || '',
        description: sectionSources.description ? normalizeText(sectionSources.description) : '',
        personality: sectionSources.personality ? normalizeText(sectionSources.personality) : '',
        scenario: sectionSources.scenario ? normalizeText(sectionSources.scenario) : '',
        first_mes: sectionSources.first_mes ? normalizeText(sectionSources.first_mes) : '',
        mes_example: mesExample,
        alternate_greetings: altGreetings,
        tags,
        topics: tags,
        creator,
        character_version: characterVersion,
        extensions,
        language,
        token_counts: {
            total: row.tokenCount ?? metadata.nTokens ?? null,
            description: row.tokenDescriptionCount ?? metadata.tokenDescriptionCount ?? null,
            personality: row.tokenPersonalityCount ?? metadata.tokenPersonalityCount ?? null,
            scenario: row.tokenScenarioCount ?? metadata.tokenScenarioCount ?? null,
            mes_example: row.tokenMesExampleCount ?? metadata.tokenMesExampleCount ?? null,
            first_mes: row.tokenFirstMessageCount ?? metadata.tokenFirstMessageCount ?? null,
            system_prompt: row.tokenSystemPromptCount ?? metadata.tokenSystemPromptCount ?? null,
            post_history: row.tokenPostHistoryCount ?? metadata.tokenPostHistoryCount ?? null
        }
    };

    const meiliMetaRows = db.prepare(
        'SELECT section, chunk_index AS chunkIndex, text_sha256 AS textHash FROM card_embedding_meta WHERE cardId = ? AND embedder_name = ?'
    ).all(cardId, EMBEDDER_NAME);

    const cardMetaMap = new Map(
        meiliMetaRows
            .filter(row => Number(row.chunkIndex) === -1)
            .map(row => [`${row.section}#-1`, row])
    );

    const chunkMetaMap = new Map(
        meiliMetaRows
            .filter(row => Number(row.chunkIndex) >= 0)
            .map(row => [`${row.section}#${row.chunkIndex}`, row])
    );

    const cardSectionEntries = baseSections.map(section => ({
        ...section,
        chunkIndex: -1,
        hash: sha256(section.text)
    }));

    const existingCardKeys = new Set(cardSectionEntries.map(entry => `${entry.section}#-1`));
    const staleCardMeta = [];
    for (const [key, rowMeta] of cardMetaMap.entries()) {
        if (!existingCardKeys.has(key)) {
            staleCardMeta.push({ section: rowMeta.section, chunkIndex: -1 });
        }
    }

    let cardNeedsUpdate = FORCE_REEMBED || staleCardMeta.length > 0 || cardSectionEntries.some(entry => {
        const key = `${entry.section}#-1`;
        const prev = cardMetaMap.get(key);
        return !prev || prev.textHash !== entry.hash;
    });

    const chunkSections = [];

    if (altGreetings.length) {
        altGreetings.forEach((greeting, idx) => {
            const slices = splitIntoChunks(greeting, { target: CHUNK_TARGET_CHARS, overlap: CHUNK_CHAR_OVERLAP });
            slices.forEach((slice, sliceIndex) => {
                chunkSections.push({
                    section: 'alt_greeting',
                    text: slice.text,
                    approxStart: slice.start,
                    logicalIndex: `${idx}-${sliceIndex}`
                });
            });
        });
    }

    for (const baseSection of baseSections) {
        const tokenEstimate = approxTokenCount(baseSection.text);
        if (tokenEstimate > CHUNK_TOKEN_THRESHOLD) {
            const slices = splitIntoChunks(baseSection.text, { target: CHUNK_TARGET_CHARS, overlap: CHUNK_CHAR_OVERLAP });
            slices.forEach((slice, sliceIndex) => {
                chunkSections.push({
                    section: baseSection.section,
                    text: slice.text,
                    approxStart: slice.start,
                    logicalIndex: `${baseSection.section}-${sliceIndex}`
                });
            });
        }
    }

    const existingChunkRows = db.prepare('SELECT id, section, chunk_index AS chunkIndex FROM card_chunk_map WHERE cardId = ?').all(cardId);
    const existingChunkIds = new Set(existingChunkRows.map(row => row.id));
    const sectionCounters = new Map();
    const newChunkEntries = [];
    const chunkKeySet = new Set();

    for (const chunkSection of chunkSections) {
        const sectionKey = chunkSection.section;
        const currentIndex = sectionCounters.get(sectionKey) || 0;
        sectionCounters.set(sectionKey, currentIndex + 1);
        const chunkId = `${cardId}-${sectionKey}-${currentIndex}`;
        const hash = sha256(chunkSection.text);
        const chunkKey = `${sectionKey}#${currentIndex}`;
        chunkKeySet.add(chunkKey);
        const approxTokensStart = chunkSection.approxStart || 0;
        const chunkTokens = approxTokenCount(chunkSection.text);
        newChunkEntries.push({
            id: chunkId,
            section: sectionKey,
            chunkIndex: currentIndex,
            text: chunkSection.text,
            hash,
            startToken: approxTokensStart,
            endToken: approxTokensStart + chunkTokens
        });
    }

    const chunkIdsToDelete = Array.from(existingChunkIds).filter(id => !newChunkEntries.find(entry => entry.id === id));
    const chunkMetaRemovals = [];
    for (const [key, rowMeta] of chunkMetaMap.entries()) {
        if (!chunkKeySet.has(key)) {
            chunkMetaRemovals.push({ section: rowMeta.section, chunkIndex: rowMeta.chunkIndex });
        }
    }

    const chunkEmbedsNeeded = FORCE_REEMBED
        ? newChunkEntries
        : newChunkEntries.filter(entry => {
            const key = `${entry.section}#${entry.chunkIndex}`;
            const prev = chunkMetaMap.get(key);
            return !prev || prev.textHash !== entry.hash;
        });

    const chunkStructureChanged = chunkIdsToDelete.length > 0 || existingChunkRows.length !== newChunkEntries.length;

    const shouldProcessChunks = FORCE_REEMBED || chunkEmbedsNeeded.length > 0 || chunkIdsToDelete.length > 0 || chunkStructureChanged;

    if (!cardNeedsUpdate && !shouldProcessChunks) {
        stats.skipped += 1;
        return;
    }

    if (cardNeedsUpdate) {
        const vectors = await embedBatchParallel(cardSectionEntries.map(entry => entry.text));
        const cardDoc = {
            id: cardId,
            data: dataPayload,
            source: row.source || metadata.source || 'chub',
            sourceId: row.sourceId || metadata.sourceId || cardId,
            sourcePath: row.sourcePath || metadata.sourcePath || metadata.fullPath || row.fullPath || '',
            sourceUrl: row.sourceUrl || metadata.sourceUrl || null,
            visibility: row.visibility || metadata.visibility || 'unknown',
            favorited: row.favorited ? 1 : 0,
            rating: row.rating ?? metadata.rating ?? null,
            ratingCount: row.ratingCount ?? metadata.ratingCount ?? null,
            starCount: row.starCount ?? metadata.starCount ?? null,
            nChats: row.nChats ?? metadata.nChats ?? null,
            nMessages: row.nMessages ?? metadata.nMessages ?? null,
            tokenCount: row.tokenCount ?? metadata.nTokens ?? null,
            updatedAt: row.lastModified || metadata.lastModified || metadata.updatedAt || row.createdAt || metadata.createdAt || null,
            createdAt: row.createdAt || metadata.createdAt || null,
            vector_sections: cardSectionEntries.map(entry => entry.section)
        };
        if (vectors.length) {
            cardDoc._vectors = {
                [EMBEDDER_NAME]: {
                    embeddings: vectors,
                    regenerate: false
                }
            };
        }

        await meiliAddDocuments(CARDS_INDEX, [cardDoc]);
        stats.cardUpdates += 1;

        const insertMetaStmt = db.prepare(
            `INSERT INTO card_embedding_meta (cardId, embedder_name, model_name, dims, section, chunk_index, text_sha256, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(cardId, embedder_name, section, chunk_index)
             DO UPDATE SET text_sha256 = excluded.text_sha256, model_name = excluded.model_name, dims = excluded.dims, updated_at = CURRENT_TIMESTAMP`
        );
        for (const entry of cardSectionEntries) {
            insertMetaStmt.run(
                cardId,
                EMBEDDER_NAME,
                EMBED_MODEL,
                vectors[0]?.length || 0,
                entry.section,
                -1,
                entry.hash
            );
        }

        const deleteMetaStmt = db.prepare(
            'DELETE FROM card_embedding_meta WHERE cardId = ? AND embedder_name = ? AND section = ? AND chunk_index = ?'
        );
        for (const stale of staleCardMeta) {
            deleteMetaStmt.run(
                cardId,
                EMBEDDER_NAME,
                stale.section,
                -1
            );
        }
    }

    if (chunkIdsToDelete.length) {
        await meiliDeleteDocuments(CHUNKS_INDEX, chunkIdsToDelete);
        stats.chunkDeletes += chunkIdsToDelete.length;
        const deletePlaceholders = chunkIdsToDelete.map(() => '?').join(',');
        db.prepare(`DELETE FROM card_chunk_map WHERE id IN (${deletePlaceholders})`).run(...chunkIdsToDelete);
    }

    if (chunkEmbedsNeeded.length) {
        const vectors = await embedBatchParallel(chunkEmbedsNeeded.map(entry => entry.text));
        const docs = chunkEmbedsNeeded.map((entry, idx) => ({
            id: entry.id,
            card_id: cardId,
            section: entry.section,
            chunk_index: entry.chunkIndex,
            text: entry.text,
            data: {
                creator,
                character_version: characterVersion,
                extensions,
                language
            },
            tags,
            source: row.source || metadata.source || 'chub',
            visibility: row.visibility || metadata.visibility || 'unknown',
            start_token: entry.startToken,
            end_token: entry.endToken,
            _vectors: {
                [EMBEDDER_NAME]: {
                    embeddings: [vectors[idx]],
                    regenerate: false
                }
            }
        }));

        await meiliAddDocuments(CHUNKS_INDEX, docs);
        stats.chunkUpdates += docs.length;

        const insertChunkMetaStmt = db.prepare(
            `INSERT INTO card_embedding_meta (cardId, embedder_name, model_name, dims, section, chunk_index, text_sha256, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(cardId, embedder_name, section, chunk_index)
             DO UPDATE SET text_sha256 = excluded.text_sha256, model_name = excluded.model_name, dims = excluded.dims, updated_at = CURRENT_TIMESTAMP`
        );
        for (const [idx, entry] of chunkEmbedsNeeded.entries()) {
            const vector = vectors[idx];
            insertChunkMetaStmt.run(
                cardId,
                EMBEDDER_NAME,
                EMBED_MODEL,
                vector.length,
                entry.section,
                entry.chunkIndex,
                entry.hash
            );
        }
    }

    const deleteChunkMetaStmt = db.prepare(
        'DELETE FROM card_embedding_meta WHERE cardId = ? AND embedder_name = ? AND section = ? AND chunk_index = ?'
    );
    for (const staleChunk of chunkMetaRemovals) {
        deleteChunkMetaStmt.run(
            cardId,
            EMBEDDER_NAME,
            staleChunk.section,
            staleChunk.chunkIndex
        );
    }

    if (shouldProcessChunks) {
        db.prepare('DELETE FROM card_chunk_map WHERE cardId = ?').run(cardId);
        const insertChunkMapStmt = db.prepare(
            `INSERT INTO card_chunk_map (id, cardId, section, chunk_index, start_token, end_token, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET section = excluded.section, chunk_index = excluded.chunk_index, start_token = excluded.start_token, end_token = excluded.end_token, updated_at = CURRENT_TIMESTAMP`
        );
        for (const entry of newChunkEntries) {
            insertChunkMapStmt.run(
                entry.id,
                cardId,
                entry.section,
                entry.chunkIndex,
                entry.startToken,
                entry.endToken
            );
        }
    }
}

async function main() {
    console.log(`[INFO] Starting vector ETL into ${CARDS_INDEX} / ${CHUNKS_INDEX}`);

    // Check for secondary Ollama instance
    if (SECONDARY_OLLAMA_URL) {
        console.log(`[INFO] Checking for secondary Ollama instance at ${SECONDARY_OLLAMA_URL}...`);
        const secondaryAvailable = await checkOllamaInstance(SECONDARY_OLLAMA_URL);
        if (secondaryAvailable) {
            OLLAMA_INSTANCES.push(SECONDARY_OLLAMA_URL);
            console.log(`[INFO] Secondary Ollama instance detected! Using ${OLLAMA_INSTANCES.length} instances for parallel embedding:`);
            OLLAMA_INSTANCES.forEach((url, idx) => console.log(`  [${idx + 1}] ${url}`));
        } else {
            console.log(`[INFO] Secondary instance configured but not available: ${SECONDARY_OLLAMA_URL}`);
            console.log(`[INFO] Using single instance: ${DEFAULT_OLLAMA_URL}`);
        }
    } else {
        console.log(`[INFO] No secondary instance configured. Using single instance: ${DEFAULT_OLLAMA_URL}`);
    }

    await initDatabase({ skipSchemaMigrations: true, skipTagRebuild: true, skipTokenBackfill: true });
    const db = getDatabase();
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM cards').get();
    stats.total = totalRow?.count || 0;

    let lastId = START_AFTER || null;
    while (true) {
        const args = [];
        let sql = 'SELECT id, name, tagline, description, topics, tokenCount, tokenDescriptionCount, tokenPersonalityCount, tokenScenarioCount, tokenMesExampleCount, tokenFirstMessageCount, tokenSystemPromptCount, tokenPostHistoryCount, author, language, source, sourceId, sourcePath, sourceUrl, visibility, favorited, hasAlternateGreetings, hasLorebook, hasEmbeddedLorebook, hasLinkedLorebook, hasExampleDialogues, hasSystemPrompt, hasGallery, isFuzzed, lastModified, createdAt, nChats, nMessages, n_favorites, starCount, fullPath FROM cards';
        if (lastId !== null && lastId !== undefined) {
            sql += ' WHERE id > ?';
            args.push(lastId);
        }
        sql += ' ORDER BY id ASC LIMIT ?';
        args.push(CARD_QUERY_PAGE_SIZE);

        const rows = db.prepare(sql).all(...args);
        if (!rows.length) {
            break;
        }

        for (const row of rows) {
            if (CARD_LIMIT && stats.processed >= CARD_LIMIT) {
                break;
            }
            await handleCard(row, db);
            stats.processed += 1;
            lastId = row.id;
            if (stats.processed % LOG_EVERY === 0) {
                console.log(`[INFO] Processed ${stats.processed}/${CARD_LIMIT || stats.total} cards — updated cards: ${stats.cardUpdates}, chunk upserts: ${stats.chunkUpdates}, chunk deletes: ${stats.chunkDeletes}, skipped: ${stats.skipped}`);
            }
        }

        if (CARD_LIMIT && stats.processed >= CARD_LIMIT) {
            break;
        }
    }

    console.log('[INFO] Vector ETL complete:', stats);
    process.exit(0);
}

main().catch(error => {
    console.error('[FATAL] Vector ETL failed:', error);
    process.exit(1);
});
