/**
 * Keyword-based tag inference for cards with sparse tagging (e.g., RisuAI)
 * Matches card text against known tags from the database
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from '../database.js';
import { logger } from './logger.js';

const log = logger.scoped('TAGGER');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache for tag data
let tagIndex = null;
let aliasMap = null;

// Minimum tag frequency to consider (filters out garbage tags)
const MIN_TAG_FREQUENCY = 50;

// Minimum word length for matching (avoids matching "a", "the", etc.)
const MIN_WORD_LENGTH = 3;

// Tags that are too generic or misleading for keyword matching
const BLACKLISTED_TAGS = new Set([
    'oc', 'original character', 'roleplay', 'scenario', 'english',
    'multiple greetings', 'fictional character', 'game characters',
    'any pov', 'anypov', 'malepov', 'fempov', 'male pov', 'female pov',
    'can be wholesome', 'can be sexy', 'sfw <-> nsfw'
]);

/**
 * Load tag frequency data from database
 */
function loadTagIndex() {
    if (tagIndex) return tagIndex;

    const db = getDatabase();
    const rows = db.prepare(`
        SELECT LOWER(tag) as tag, COUNT(*) as cnt
        FROM card_tags
        GROUP BY LOWER(tag)
        HAVING cnt >= ?
        ORDER BY cnt DESC
    `).all(MIN_TAG_FREQUENCY);

    tagIndex = new Map();
    for (const row of rows) {
        const tag = row.tag.toLowerCase();
        if (!BLACKLISTED_TAGS.has(tag) && tag.length >= MIN_WORD_LENGTH) {
            tagIndex.set(tag, row.cnt);
        }
    }

    log.info(`Loaded ${tagIndex.size} tags for keyword matching`);
    return tagIndex;
}

/**
 * Load tag aliases
 */
function loadAliases() {
    if (aliasMap) return aliasMap;

    aliasMap = new Map();
    try {
        const aliasPath = path.join(__dirname, '../../tag-aliases.json');
        const aliases = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));

        for (const [canonical, variants] of Object.entries(aliases)) {
            for (const variant of variants) {
                aliasMap.set(variant.toLowerCase(), canonical.toLowerCase());
            }
        }
        log.info(`Loaded ${aliasMap.size} tag aliases`);
    } catch (err) {
        log.warn('Failed to load tag aliases', err.message);
    }

    return aliasMap;
}

/**
 * Normalize a tag using aliases
 */
function normalizeTag(tag) {
    const aliases = loadAliases();
    const lower = tag.toLowerCase();
    return aliases.get(lower) || lower;
}

/**
 * Extract potential tags from text using keyword matching
 */
function extractTagsFromText(text, existingTags = []) {
    if (!text) return [];

    const tags = loadTagIndex();
    const found = new Set();
    const existingLower = new Set(existingTags.map(t => t.toLowerCase()));

    // Normalize text: lowercase, remove special chars except spaces
    const normalized = text.toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, ' ');

    // Check each known tag against the text
    for (const [tag, frequency] of tags) {
        // Skip if already tagged
        if (existingLower.has(tag)) continue;

        // For multi-word tags, require exact phrase match
        if (tag.includes(' ') || tag.includes('-')) {
            const searchTerm = tag.replace(/-/g, '[- ]?');
            const regex = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`, 'i');
            if (regex.test(normalized)) {
                found.add(tag);
            }
        } else {
            // Single word: require word boundary match
            const regex = new RegExp(`\\b${escapeRegex(tag)}\\b`, 'i');
            if (regex.test(normalized)) {
                found.add(tag);
            }
        }
    }

    return Array.from(found);
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Infer tags for a card based on its content
 */
export function inferTags(card) {
    const textParts = [
        card.name || '',
        card.description || '',
        card.tagline || '',
        card.personality || '',
        card.scenario || ''
    ];

    // Also check card definition if available
    if (card.definition?.data) {
        const data = card.definition.data;
        textParts.push(
            data.description || '',
            data.personality || '',
            data.scenario || '',
            data.first_mes || '',
            data.mes_example || ''
        );
    }

    const fullText = textParts.join(' ');
    const existingTags = card.topics || [];

    const inferred = extractTagsFromText(fullText, existingTags);

    // Normalize inferred tags
    const normalized = inferred.map(normalizeTag);

    // Remove duplicates after normalization
    return [...new Set(normalized)];
}

/**
 * Get tags for a RisuAI card, combining existing and inferred
 */
export function getEnhancedTags(card) {
    const existing = card.topics || [];
    const inferred = inferTags(card);

    // Combine, normalize, dedupe
    const combined = [...existing, ...inferred]
        .map(t => normalizeTag(t))
        .filter((t, i, arr) => arr.indexOf(t) === i);

    return combined;
}

/**
 * Batch process cards to add inferred tags
 */
export function batchInferTags(cards) {
    // Ensure index is loaded
    loadTagIndex();
    loadAliases();

    return cards.map(card => ({
        ...card,
        inferredTags: inferTags(card)
    }));
}

export default {
    inferTags,
    getEnhancedTags,
    batchInferTags,
    normalizeTag,
    loadTagIndex
};
