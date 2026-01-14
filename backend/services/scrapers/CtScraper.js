/**
 * CtScraper - Scraper for Character Tavern
 *
 * Extends BaseScraper with CT-specific:
 * - REST API at /api/search/cards
 * - Authentication via Cloudflare cookies (cf_clearance)
 * - Direct PNG download from cards.character-tavern.com
 * - Sort options: newest, trending, oldest
 */

import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaseScraper } from './BaseScraper.js';
import { detectLanguage } from '../../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEARCH_URL = 'https://character-tavern.com/api/search/cards';
const CARDS_BASE_URL = 'https://cards.character-tavern.com';
const CT_SITE_URL = 'https://character-tavern.com';

const DEFAULT_HEADERS = {
    accept: '*/*',
    dnt: '1',
    referer: `${CT_SITE_URL}/`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
};

export class CtScraper extends BaseScraper {
    constructor() {
        super({
            source: 'ct',
            displayName: 'Character Tavern'
        });

        // CT uses database blacklist file in data/
        this.blacklistFile = path.join(__dirname, '../../../data/ct-blacklist.txt');
    }

    // ==================== Helper Methods ====================

    normalizeEpoch(value) {
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

    toSqlTimestamp(value) {
        if (!value || value === 0 || value === '0') {
            return new Date().toISOString().replace('T', ' ').split('.')[0];
        }
        const normalized = this.normalizeEpoch(value);
        const date = typeof normalized === 'number' ? new Date(normalized) : new Date(normalized);
        if (Number.isNaN(date.getTime())) {
            return new Date().toISOString().replace('T', ' ').split('.')[0];
        }
        return date.toISOString().replace('T', ' ').split('.')[0];
    }

    collapseExamples(examples) {
        if (!examples) return '';
        if (typeof examples === 'string') return examples;
        if (Array.isArray(examples)) {
            return examples
                .map(entry => {
                    if (typeof entry === 'string') return entry;
                    if (entry && typeof entry === 'object') {
                        const text = entry.example || entry.text || entry.message;
                        if (text) return text;
                        try { return JSON.stringify(entry); } catch { return ''; }
                    }
                    return '';
                })
                .filter(Boolean)
                .join('\n');
        }
        if (typeof examples === 'object') {
            try { return JSON.stringify(examples); } catch { return ''; }
        }
        return '';
    }

    sanitizeTags(tags) {
        if (!Array.isArray(tags)) return [];
        return Array.from(new Set(tags.map(tag => (tag || '').toString().trim()).filter(Boolean)));
    }

    matchesBannedTags(hit, bannedLower) {
        if (!bannedLower.length) return false;
        const tagSet = new Set((hit.tags || []).map(tag => tag.toLowerCase()));
        return bannedLower.some(tag => tagSet.has(tag));
    }

    formatDescription(hit) {
        return hit.characterDefinition || hit.pageDescription || hit.characterScenario || '';
    }

    buildCookies(config) {
        const cookies = [];
        if (config.cfClearance) {
            cookies.push(`cf_clearance=${config.cfClearance.trim()}`);
        }
        if (config.session) {
            cookies.push(`session=${config.session.trim()}`);
        }
        if (config.allowedWarnings) {
            cookies.push(`content_warnings=${config.allowedWarnings.trim()}`);
        }
        return cookies;
    }

    // ==================== Abstract Method Implementations ====================

    getSourceId(item) {
        return item.id;
    }

    getRemoteTimestamp(item) {
        return item.lastUpdateAt || item.updatedAt || item.updated_at || item.createdAt || item.created_at;
    }

    getImageRef(item) {
        return item.path;
    }

    /**
     * Fetch paginated list from CT's search API
     */
    async fetchList(page, config) {
        const {
            hitsPerPage = 30,
            bannedTags = [],
            cookies = [],
            sort = 'newest',
            query = ''
        } = config;

        // Build query params
        const params = new URLSearchParams();
        params.set('limit', String(hitsPerPage));
        params.set('page', String(page));
        params.set('sort', sort);
        if (query) {
            params.set('query', query);
        }

        const url = `${SEARCH_URL}?${params.toString()}`;

        const headers = { ...DEFAULT_HEADERS };

        if (cookies.length > 0) {
            headers.Cookie = cookies.join('; ');
        }

        try {
            const response = await axios.get(url, {
                headers,
                timeout: 30000
            });

            const hits = response.data?.hits || [];

            // Store banned tags filter for processCard
            this._bannedTagsLower = (bannedTags || []).map(t => t.toLowerCase());
            this._totalPages = response.data?.totalPages || null;

            return hits;
        } catch (error) {
            if (error?.response?.status === 403) {
                throw new Error('Character Tavern search returned 403 (check Cloudflare cookie)');
            }
            throw error;
        }
    }

    /**
     * CT doesn't need separate card fetch - data comes from list
     */
    async fetchCard(_sourceId) {
        // Not used for CT - all data comes from list
        return { data: null, error: 'Not implemented' };
    }

    /**
     * Download card PNG from CT CDN
     */
    async fetchImage(cardPath) {
        if (!cardPath) return null;

        const url = `${CARDS_BASE_URL}/${cardPath}.png?action=download`;
        const headers = {
            accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            referer: `${CT_SITE_URL}/`,
            'user-agent': DEFAULT_HEADERS['user-agent']
        };

        // Add cookies if we have them stored
        if (this._currentCookies && this._currentCookies.length > 0) {
            headers.Cookie = this._currentCookies.join('; ');
        }

        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                headers,
                timeout: 30000
            });
            return Buffer.from(response.data);
        } catch (error) {
            this.log.warn(`Failed to download image for ${cardPath}`, error.message);
            return null;
        }
    }

    deriveFeatureFlags(hit) {
        return {
            hasAlternateGreetings: Array.isArray(hit.alternativeFirstMessage) &&
                hit.alternativeFirstMessage.some(msg => typeof msg === 'string' && msg.trim().length > 0),
            hasExampleDialogues: !!(hit.characterExampleMessages &&
                (typeof hit.characterExampleMessages === 'string'
                    ? hit.characterExampleMessages.trim().length > 0
                    : Array.isArray(hit.characterExampleMessages) && hit.characterExampleMessages.length > 0)),
            hasSystemPrompt: !!(hit.characterPostHistoryPrompt && hit.characterPostHistoryPrompt.trim().length > 0),
            hasLorebook: false,
            hasEmbeddedLorebook: false,
            hasLinkedLorebook: false,
            hasGallery: false,
            hasEmbeddedImages: false,
            hasExpressions: false
        };
    }

    async parseCardToMetadata(hit, dbId) {
        const description = this.formatDescription(hit);
        const tags = this.sanitizeTags(hit.tags || []);
        const language = detectLanguage(description || hit.tagline || hit.characterFirstMessage || '');
        const flags = this.deriveFeatureFlags(hit);

        const createdAtRaw = hit.createdAt || hit.created_at;
        const lastUpdateAtRaw = hit.lastUpdateAt || hit.updatedAt || hit.updated_at;
        const createdAtSql = this.toSqlTimestamp(createdAtRaw);
        const lastUpdateSql = this.toSqlTimestamp(
            (lastUpdateAtRaw === 0 || lastUpdateAtRaw === '0') ? createdAtRaw : (lastUpdateAtRaw || createdAtRaw)
        );

        const ctPath = (hit.path || '').trim().replace(/^\/+/, '');
        const sourceUrl = `${CT_SITE_URL}/character/${ctPath || hit.id}`;

        return {
            id: dbId,
            author: hit.author || '',
            name: hit.name || hit.inChatName || 'Untitled',
            tagline: hit.tagline || '',
            description,
            topics: tags,
            tokenCount: hit.totalTokens || 0,
            tokenDescriptionCount: null,
            tokenPersonalityCount: null,
            tokenScenarioCount: null,
            tokenMesExampleCount: null,
            tokenFirstMessageCount: null,
            tokenSystemPromptCount: null,
            tokenPostHistoryCount: null,
            lastModified: lastUpdateSql,
            lastActivityAt: lastUpdateSql,
            createdAt: createdAtSql,
            nChats: hit.views || 0,
            nMessages: hit.messages || 0,
            n_favorites: hit.likes || 0,
            starCount: hit.downloads || 0,
            ratingsEnabled: 0,
            rating: 0,
            ratingCount: 0,
            fullPath: hit.path || '',
            favorited: 0,
            language,
            visibility: 'public',
            ...flags,
            source: 'ct',
            sourceId: hit.id,
            sourcePath: hit.path || '',
            sourceUrl,
            // CT-specific metadata for JSON sidecar
            alternate_greetings: Array.isArray(hit.alternativeFirstMessage) ? hit.alternativeFirstMessage : [],
            mes_example: this.collapseExamples(hit.characterExampleMessages),
            system_prompt: hit.characterPostHistoryPrompt || '',
            rawHit: hit
        };
    }

    /**
     * Override processCard to handle CT-specific filtering
     */
    async processCard(item, config = {}) {
        const sourceId = this.getSourceId(item);

        // Check banned tags
        if (this._bannedTagsLower && this.matchesBannedTags(item, this._bannedTagsLower)) {
            return { success: false, reason: 'banned_tags' };
        }

        // Check min tokens
        if (item.totalTokens && item.totalTokens < (config.minTokens || 300)) {
            return { success: false, reason: 'below_min_tokens' };
        }

        // Check blacklist
        if (this.isBlacklisted(sourceId)) {
            return { success: false, reason: 'blacklisted' };
        }

        // Check existing
        const existing = this.checkExisting(sourceId);
        if (existing) {
            return { success: false, reason: 'already_exists', dbId: existing.id };
        }

        const dbId = this.getNextDbId();

        try {
            // Parse metadata
            const metadata = await this.parseCardToMetadata(item, dbId);

            // Fetch image
            const imageBuffer = await this.fetchImage(item.path);
            if (!imageBuffer) {
                this.log.warn(`No image for CT card ${sourceId}`);
            }

            // Write files
            const filesToWrite = { json: metadata };
            if (imageBuffer) {
                filesToWrite.png = imageBuffer;
            }

            await this.writeCardFiles(dbId, filesToWrite);
            this.upsertCard(metadata);

            this.log.info(`Imported CT card: ${metadata.name} (${sourceId} -> ${dbId})`);

            return {
                success: true,
                isNew: true,
                dbId,
                name: metadata.name
            };
        } catch (error) {
            this.log.error(`Failed to import CT card ${item?.name || item?.path || item?.id}`, error);
            return { success: false, reason: 'error', error: error.message };
        }
    }

    /**
     * Override sync to handle CT-specific configuration
     */
    async sync(config = {}, progressCallback = null) {
        const pageLimit = config.pages || config.pageLimit || 1;

        const cookies = this.buildCookies({
            cfClearance: config.cfClearance || process.env.CT_CF_CLEARANCE,
            session: config.session || process.env.CT_SESSION,
            allowedWarnings: config.allowedWarnings || process.env.CT_ALLOWED_WARNINGS
        });

        // Store cookies for image download
        this._currentCookies = cookies;

        const scraperConfig = {
            cookies,
            hitsPerPage: Math.min(config.hitsPerPage || 30, 50),
            minTokens: config.minTokens || 300,
            bannedTags: config.bannedTags || [],
            sort: config.sort || 'newest',
            query: config.query || ''
        };

        this.log.info(`Starting CT sync (${pageLimit} pages)...`);
        this.loadBlacklist();

        let added = 0;
        let skipped = 0;
        let processed = 0;

        for (let page = 1; page <= pageLimit; page++) {
            let hits;
            try {
                hits = await this.fetchList(page, scraperConfig);
            } catch (error) {
                this.log.error(`Failed to fetch CT page ${page}`, error.message);
                throw error;
            }

            if (!hits || hits.length === 0) {
                this.log.info(`No more results on page ${page}`);
                break;
            }

            for (const hit of hits) {
                processed++;
                const result = await this.processCard(hit, scraperConfig);

                if (result.success) {
                    added++;
                    this.reportProgress(progressCallback, {
                        progress: Math.round((page / pageLimit) * 100),
                        currentCard: `[CT] ${result.name}`,
                        newCards: added,
                        page,
                        processed,
                        added,
                        skipped
                    });
                } else {
                    skipped++;
                }
            }

            // Check if we've reached the end
            if (this._totalPages && page >= this._totalPages) {
                break;
            }
        }

        this.log.info(`CT sync complete: ${added} added, ${skipped} skipped, ${processed} processed`);

        return { success: true, newCards: added, updatedCards: 0, added, skipped, processed };
    }
}

// Export singleton instance for backwards compatibility
export const ctScraper = new CtScraper();

// Export sync function for backwards compatibility
export async function syncCharacterTavern(appConfig = {}, progressCallback = null) {
    const scraper = new CtScraper();
    const ctConfig = appConfig.ctSync || {};

    if (!ctConfig.enabled) {
        return { added: 0, skipped: 0, processed: 0 };
    }

    return scraper.sync(ctConfig, progressCallback);
}

export default CtScraper;
