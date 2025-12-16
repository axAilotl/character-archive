import axios from 'axios';
import { appConfig } from '../services/ConfigState.js';
import { logger } from '../utils/logger.js';

const log = logger.scoped('SYNC-SVC');

const CHUB_API_BASE = 'https://gateway.chub.ai/api';
const DEFAULT_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36';

export async function fetchChubBlockedUsers() {
    const apiKey = (appConfig.chubApiKey || '').trim();
    if (!apiKey) {
        throw new Error('Chub API key is required to fetch blocked users (set in Chub settings tab)');
    }

    const headers = {
        'User-Agent': DEFAULT_BROWSER_UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://chub.ai/',
        'samwise': apiKey,
        'CH-API-KEY': apiKey
    };

    try {
        log.info('Fetching blocked users from Chub API...');
        const response = await axios.get(`${CHUB_API_BASE}/account`, {
            headers,
            timeout: 15000,
            validateStatus: () => true
        });

        log.info(`Chub API response status: ${response.status}`);

        if (response.status < 200 || response.status >= 300) {
            log.error('Chub API error response:', response.data);
            throw new Error(response.data?.error || `Chub API returned status ${response.status}`);
        }

        const blockedUsers = Array.isArray(response.data?.blocked_users)
            ? response.data.blocked_users.filter(u => typeof u === 'string' && u.trim())
            : [];

        log.info(`Fetched ${blockedUsers.length} blocked users from Chub`);
        return { blockedUsers };
    } catch (error) {
        log.error('Failed to fetch blocked users:', error?.message || error);
        throw new Error(error?.message || 'Failed to fetch blocked users from Chub');
    }
}

export async function fetchChubFollows(profile, { maxPages = 10 } = {}) {
    const trimmed = (profile || '').trim().replace(/^@/, '');
    if (!trimmed) {
        throw new Error('Profile name is required');
    }

    const headers = {
        'User-Agent': DEFAULT_BROWSER_UA,
        Accept: 'application/json, text/plain, */*'
    };

    const creators = new Map();
    for (let page = 1; page <= maxPages; page += 1) {
        try {
            const response = await axios.get(`${CHUB_API_BASE}/follows/${encodeURIComponent(trimmed)}?page=${page}`, {
                headers,
                timeout: 15000,
                validateStatus: () => true
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(response.data?.error || `Chub API returned status ${response.status}`);
            }

            const follows = Array.isArray(response.data?.follows) ? response.data.follows : [];
            follows.forEach(follow => {
                const username = (follow?.username || '').trim();
                if (!username) {
                    return;
                }
                const key = username.toLowerCase();
                if (!creators.has(key)) {
                    creators.set(key, {
                        username,
                        userId: follow?.user_id ?? null,
                        avatarUrl: follow?.avatar_url ?? null
                    });
                }
            });

            if (!follows.length) {
                break;
            }
        } catch (error) {
            throw new Error(error?.message || 'Failed to contact Chub API');
        }
    }
    
    return {
        profile: trimmed,
        creators: Array.from(creators.values())
    };
}

// Helper to check if source is Chub
function isChubSource(source) {
    if (!source) return true; // default to chub
    return source === 'chub';
}

export async function syncFavoriteToChub(cardInfo, favorited) {
    const apiKey = (appConfig.chubApiKey || '').trim();
    if (!apiKey) {
        return false;
    }
    if (!cardInfo || !isChubSource(cardInfo.source)) {
        return false;
    }
    const remoteId = cardInfo.sourceId || cardInfo.id;
    if (!remoteId) {
        return false;
    }

    const endpoint = `https://gateway.chub.ai/api/favorites/${remoteId}`;
    const headers = {
        'samwise': apiKey,
        'CH-API-KEY': apiKey,
        'accept': '*/*',
        'content-type': 'application/json',
        'origin': 'https://chub.ai',
        'referer': 'https://chub.ai/',
        'user-agent': 'LocalChubRedux/1.0'
    };

    const method = favorited ? 'post' : 'delete';
    try {
        await axios.request({
            method,
            url: endpoint,
            headers,
            data: {},
            timeout: 15000
        });
        console.log(`[INFO] Synced favorite ${favorited ? 'add' : 'remove'} to Chub for project ${remoteId}`);
        return true;
    } catch (error) {
        const status = error?.response?.status;
        log.warn(`Failed to sync favorite (${favorited ? 'add' : 'remove'}) to Chub for project ${remoteId}`, error || { status });
        return false;
    }
}