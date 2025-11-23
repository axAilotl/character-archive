
import fs from 'fs';
import path from 'path';
import { getDatabase } from '../database.js';
import { appConfig } from '../services/ConfigState.js';
import { cacheGalleryAssets, getGalleryAssets, clearCardAssets } from './asset-cache.js';

const STATIC_DIR = path.join(process.cwd(), 'static');

export async function setCardGalleryFlag(cardId, hasGallery) {
    try {
        const db = getDatabase();
        db.prepare('UPDATE cards SET hasGallery = ? WHERE id = ?').run(hasGallery ? 1 : 0, cardId);
    } catch (error) {
        console.error(`[WARN] Failed to update gallery flag in database for ${cardId}:`, error.message);
    }

    try {
        const cardIdStr = String(cardId);
        const subfolder = path.join(STATIC_DIR, cardIdStr.substring(0, 2));
        const jsonPath = path.join(subfolder, `${cardIdStr}.json`);

        if (fs.existsSync(jsonPath)) {
            const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (metadata.hasGallery !== !!hasGallery) {
                metadata.hasGallery = !!hasGallery;
                fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 4));
            }
        }
    } catch (error) {
        console.error(`[WARN] Failed to update metadata for card ${cardId}:`, error.message);
    }
}

export async function setCardFavoriteFlag(cardId, favorited) {
    try {
        const db = getDatabase();
        db.prepare('UPDATE cards SET favorited = ? WHERE id = ?').run(favorited ? 1 : 0, cardId);
    } catch (error) {
        console.error(`[WARN] Failed to update favorite flag in database for ${cardId}:`, error.message);
    }

    try {
        const cardIdStr = String(cardId);
        const subfolder = path.join(STATIC_DIR, cardIdStr.substring(0, 2));
        const jsonPath = path.join(subfolder, `${cardIdStr}.json`);

        if (fs.existsSync(jsonPath)) {
            const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            const nextFavorited = favorited ? 1 : 0;
            // Check both legacy and new property
            if (metadata.is_favorite !== favorited || metadata.favorited !== nextFavorited) {
                metadata.is_favorite = favorited;
                metadata.favorited = nextFavorited;
                fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 4));
            }
        }
    } catch (error) {
        console.error(`[WARN] Failed to update favorite metadata for card ${cardId}:`, error.message);
    }
}

export async function refreshGalleryIfNeeded(cardId) {
    try {
        const db = getDatabase();
        const row = db.prepare('SELECT favorited, hasGallery FROM cards WHERE id = ?').get(cardId);

        if (!row || !row.favorited) {
            return null;
        }

        let hasGallery = !!row.hasGallery;

        if (!hasGallery) {
            try {
                const cardIdStr = String(cardId);
                const subfolder = path.join(STATIC_DIR, cardIdStr.substring(0, 2));
                const jsonPath = path.join(subfolder, `${cardIdStr}.json`);
                if (fs.existsSync(jsonPath)) {
                    const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    hasGallery = !!metadata.hasGallery;
                }
            } catch (error) {
                console.warn(`[WARN] Failed to inspect metadata for gallery on card ${cardId}:`, error.message);
            }
        }

        if (!hasGallery) {
            return null;
        }

        const galleryResult = await cacheGalleryAssets(cardId, appConfig.apikey, { retries: 3 });

        if (galleryResult?.success !== false) {
            const cachedCount = galleryResult.cached || 0;
            const skippedCount = galleryResult.skipped || 0;
            hasGallery = (cachedCount + skippedCount) > 0;
        } else {
            const existing = await getGalleryAssets(cardId);
            hasGallery = existing.success && existing.assets.length > 0;
            if (galleryResult) {
                galleryResult.assets = existing.assets;
            }
        }

        await setCardGalleryFlag(cardId, hasGallery);
        return galleryResult;
    } catch (error) {
        console.error(`[WARN] Gallery refresh failed for card ${cardId}:`, error.message);
        return null;
    }
}
