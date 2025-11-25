import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const log = logger.scoped('CT-BLACKLIST');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CT_BLACKLIST_FILE = path.join(__dirname, '../../ct-blacklist.txt');

const ctBlacklist = new Set();
let loaded = false;

function ensureLoaded() {
    if (loaded) {
        return;
    }
    try {
        if (!fs.existsSync(CT_BLACKLIST_FILE)) {
            fs.writeFileSync(CT_BLACKLIST_FILE, '');
            loaded = true;
            return;
        }
        const contents = fs.readFileSync(CT_BLACKLIST_FILE, 'utf8');
        contents
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .forEach(id => ctBlacklist.add(id));
    } catch (error) {
        log.warn('Failed to read ct-blacklist.txt', error);
    } finally {
        loaded = true;
    }
}

export function isCtBlacklisted(sourceId) {
    if (!sourceId) {
        return false;
    }
    ensureLoaded();
    return ctBlacklist.has(String(sourceId));
}

export function addCtBlacklistEntry(sourceId) {
    if (!sourceId) {
        return;
    }
    ensureLoaded();
    const normalized = String(sourceId).trim();
    if (!normalized || ctBlacklist.has(normalized)) {
        return;
    }
    ctBlacklist.add(normalized);
    try {
        fs.appendFileSync(CT_BLACKLIST_FILE, `${normalized}\n`);
    } catch (error) {
        log.error('Failed to append to ct-blacklist.txt', error);
    }
}

export function getCtBlacklistSnapshot() {
    ensureLoaded();
    return new Set(ctBlacklist);
}
