# Federation Implementation Plan for Character Archive

**Goal:** Enable bi-directional sync between Character Archive, Character Architect, and SillyTavern.

**Date:** 2024-12-05

---

## Overview

Character Archive already has:
- Push to SillyTavern via `importURL` endpoint
- Push to Character Architect (basic URL-based)
- Sync from Chub and Character Tavern

This plan adds **true federation** with:
- Tracked sync state (which cards are synced where)
- Bi-directional updates
- Conflict detection
- Federation settings modal

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Character Archive (Node.js + Next.js)             │
├─────────────────────────────────────────────────────────────────────┤
│  Frontend (Next.js)                                                  │
│  ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────┐ │
│  │ FederationModal  │   │ useFederation    │   │ federation/     │ │
│  │ (settings UI)    │   │ (React hook)     │   │ api.ts          │ │
│  └──────────────────┘   └──────────────────┘   └─────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  Backend (Express)                                                   │
│  ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────┐ │
│  │ FederationService│   │ federation.js    │   │ SQLite tables   │ │
│  │                  │   │ (routes)         │   │ (sync_state)    │ │
│  └──────────────────┘   └──────────────────┘   └─────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
           ↓                        ↓                      ↓
┌──────────────────┐   ┌──────────────────────┐   ┌─────────────────┐
│ Character        │   │ SillyTavern          │   │ CardsHub        │
│ Architect API    │   │ /api/plugins/cforge  │   │ (future)        │
└──────────────────┘   └──────────────────────┘   └─────────────────┘
```

---

## Database Schema Addition

Add to `cards.db`:

```sql
-- Federation sync state tracking
CREATE TABLE IF NOT EXISTS federation_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    platform TEXT NOT NULL,           -- 'architect', 'sillytavern', 'hub'
    platform_id TEXT,                 -- ID on remote platform
    last_sync_at TEXT,                -- ISO timestamp
    local_hash TEXT,                  -- Hash of local card data at sync time
    remote_hash TEXT,                 -- Hash of remote card data at sync time
    status TEXT DEFAULT 'pending',    -- 'synced', 'pending', 'conflict', 'error'
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(card_id, platform),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_federation_sync_card ON federation_sync(card_id);
CREATE INDEX IF NOT EXISTS idx_federation_sync_platform ON federation_sync(platform);
CREATE INDEX IF NOT EXISTS idx_federation_sync_status ON federation_sync(status);

-- Federation platform configuration
CREATE TABLE IF NOT EXISTS federation_platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,                     -- Encrypted or null
    enabled INTEGER DEFAULT 0,
    last_connected_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Pre-populate platforms
INSERT OR IGNORE INTO federation_platforms (platform, display_name, enabled)
VALUES
    ('architect', 'Character Architect', 0),
    ('sillytavern', 'SillyTavern', 0),
    ('hub', 'CardsHub', 0);
```

---

## Backend Implementation

### 1. Federation Service

**File:** `backend/services/FederationService.js`

```javascript
import axios from 'axios';
import crypto from 'crypto';
import { getDatabase } from '../database.js';
import { loadConfig } from '../../config.js';

class FederationService {
    constructor() {
        this.platforms = new Map();
    }

    /**
     * Initialize federation tables
     */
    async initTables() {
        const db = getDatabase();

        db.exec(`
            CREATE TABLE IF NOT EXISTS federation_sync (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                platform_id TEXT,
                last_sync_at TEXT,
                local_hash TEXT,
                remote_hash TEXT,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(card_id, platform),
                FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_federation_sync_card ON federation_sync(card_id);
            CREATE INDEX IF NOT EXISTS idx_federation_sync_platform ON federation_sync(platform);
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS federation_platforms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                base_url TEXT,
                api_key TEXT,
                enabled INTEGER DEFAULT 0,
                last_connected_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            INSERT OR IGNORE INTO federation_platforms (platform, display_name, enabled)
            VALUES
                ('architect', 'Character Architect', 0),
                ('sillytavern', 'SillyTavern', 0),
                ('hub', 'CardsHub', 0);
        `);
    }

    /**
     * Hash card data for change detection
     */
    hashCardData(cardData) {
        const normalized = JSON.stringify(cardData, Object.keys(cardData).sort());
        return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    }

    /**
     * Get platform configuration
     */
    getPlatformConfig(platform) {
        const db = getDatabase();
        return db.prepare('SELECT * FROM federation_platforms WHERE platform = ?').get(platform);
    }

    /**
     * Update platform configuration
     */
    updatePlatformConfig(platform, config) {
        const db = getDatabase();
        const { base_url, api_key, enabled } = config;

        db.prepare(`
            UPDATE federation_platforms
            SET base_url = ?, api_key = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
            WHERE platform = ?
        `).run(base_url, api_key, enabled ? 1 : 0, platform);

        return this.getPlatformConfig(platform);
    }

    /**
     * Get all platform configs
     */
    getAllPlatforms() {
        const db = getDatabase();
        return db.prepare('SELECT * FROM federation_platforms').all();
    }

    /**
     * Test platform connection
     */
    async testConnection(platform) {
        const config = this.getPlatformConfig(platform);
        if (!config || !config.base_url) {
            return { connected: false, error: 'Platform not configured' };
        }

        try {
            let healthEndpoint;
            switch (platform) {
                case 'architect':
                    healthEndpoint = `${config.base_url}/api/health`;
                    break;
                case 'sillytavern':
                    healthEndpoint = `${config.base_url}/api/plugins/cforge/probe`;
                    break;
                case 'hub':
                    healthEndpoint = `${config.base_url}/api/health`;
                    break;
                default:
                    return { connected: false, error: 'Unknown platform' };
            }

            const response = await axios.get(healthEndpoint, {
                timeout: 5000,
                headers: config.api_key ? { 'Authorization': `Bearer ${config.api_key}` } : {},
            });

            if (response.status === 200) {
                const db = getDatabase();
                db.prepare(`
                    UPDATE federation_platforms
                    SET last_connected_at = CURRENT_TIMESTAMP
                    WHERE platform = ?
                `).run(platform);

                return { connected: true, data: response.data };
            }

            return { connected: false, error: `HTTP ${response.status}` };
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }

    /**
     * Get sync state for a card
     */
    getSyncState(cardId) {
        const db = getDatabase();
        return db.prepare(`
            SELECT fs.*, fp.display_name, fp.base_url, fp.enabled
            FROM federation_sync fs
            JOIN federation_platforms fp ON fs.platform = fp.platform
            WHERE fs.card_id = ?
        `).all(cardId);
    }

    /**
     * Get all cards with sync state for a platform
     */
    getCardsSyncedToPlatform(platform, status = null) {
        const db = getDatabase();
        let query = `
            SELECT c.*, fs.platform_id, fs.last_sync_at, fs.status, fs.local_hash, fs.remote_hash
            FROM cards c
            JOIN federation_sync fs ON c.id = fs.card_id
            WHERE fs.platform = ?
        `;
        const params = [platform];

        if (status) {
            query += ' AND fs.status = ?';
            params.push(status);
        }

        return db.prepare(query).all(...params);
    }

    /**
     * Push card to Character Architect
     */
    async pushToArchitect(cardId, cardData, imageBuffer) {
        const config = this.getPlatformConfig('architect');
        if (!config || !config.enabled || !config.base_url) {
            throw new Error('Character Architect not configured');
        }

        const db = getDatabase();
        const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
        if (!card) {
            throw new Error('Card not found');
        }

        try {
            const response = await axios.post(`${config.base_url}/api/cards/import`, {
                cardData,
                image: imageBuffer ? imageBuffer.toString('base64') : null,
                source: 'character_archive',
                sourceId: String(cardId),
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.api_key ? { 'Authorization': `Bearer ${config.api_key}` } : {}),
                },
                timeout: 30000,
            });

            const localHash = this.hashCardData(cardData);

            // Update sync state
            db.prepare(`
                INSERT INTO federation_sync (card_id, platform, platform_id, last_sync_at, local_hash, status)
                VALUES (?, 'architect', ?, CURRENT_TIMESTAMP, ?, 'synced')
                ON CONFLICT(card_id, platform) DO UPDATE SET
                    platform_id = excluded.platform_id,
                    last_sync_at = CURRENT_TIMESTAMP,
                    local_hash = excluded.local_hash,
                    status = 'synced',
                    error_message = NULL,
                    updated_at = CURRENT_TIMESTAMP
            `).run(cardId, response.data.id || response.data.cardId, localHash);

            return { success: true, remoteId: response.data.id };
        } catch (error) {
            // Record error in sync state
            db.prepare(`
                INSERT INTO federation_sync (card_id, platform, status, error_message)
                VALUES (?, 'architect', 'error', ?)
                ON CONFLICT(card_id, platform) DO UPDATE SET
                    status = 'error',
                    error_message = excluded.error_message,
                    updated_at = CURRENT_TIMESTAMP
            `).run(cardId, error.message);

            throw error;
        }
    }

    /**
     * Push card to SillyTavern via CForge plugin
     */
    async pushToSillyTavern(cardId, cardData, imageBuffer, overwrite = false) {
        const config = this.getPlatformConfig('sillytavern');
        if (!config || !config.enabled || !config.base_url) {
            throw new Error('SillyTavern not configured');
        }

        const db = getDatabase();
        const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
        if (!card) {
            throw new Error('Card not found');
        }

        // Check if already synced
        const existingSync = db.prepare(`
            SELECT * FROM federation_sync
            WHERE card_id = ? AND platform = 'sillytavern'
        `).get(cardId);

        try {
            const response = await axios.post(`${config.base_url}/api/plugins/cforge/sync/import`, {
                cardData,
                filename: cardData.data?.name || card.name,
                image: imageBuffer ? imageBuffer.toString('base64') : null,
                overwrite: overwrite && existingSync?.platform_id ? true : false,
                user: 'default', // Or from config
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.api_key ? { 'Authorization': `Bearer ${config.api_key}` } : {}),
                },
                timeout: 30000,
            });

            const localHash = this.hashCardData(cardData);

            db.prepare(`
                INSERT INTO federation_sync (card_id, platform, platform_id, last_sync_at, local_hash, status)
                VALUES (?, 'sillytavern', ?, CURRENT_TIMESTAMP, ?, 'synced')
                ON CONFLICT(card_id, platform) DO UPDATE SET
                    platform_id = excluded.platform_id,
                    last_sync_at = CURRENT_TIMESTAMP,
                    local_hash = excluded.local_hash,
                    status = 'synced',
                    error_message = NULL,
                    updated_at = CURRENT_TIMESTAMP
            `).run(cardId, response.data.filename, localHash);

            return { success: true, filename: response.data.filename };
        } catch (error) {
            db.prepare(`
                INSERT INTO federation_sync (card_id, platform, status, error_message)
                VALUES (?, 'sillytavern', 'error', ?)
                ON CONFLICT(card_id, platform) DO UPDATE SET
                    status = 'error',
                    error_message = excluded.error_message,
                    updated_at = CURRENT_TIMESTAMP
            `).run(cardId, error.message);

            throw error;
        }
    }

    /**
     * Bulk sync status check
     */
    async checkBulkSyncStatus(cardIds) {
        const db = getDatabase();
        const placeholders = cardIds.map(() => '?').join(',');

        return db.prepare(`
            SELECT
                c.id as card_id,
                c.name,
                GROUP_CONCAT(DISTINCT fs.platform) as synced_platforms,
                GROUP_CONCAT(DISTINCT CASE WHEN fs.status = 'synced' THEN fs.platform END) as active_syncs,
                GROUP_CONCAT(DISTINCT CASE WHEN fs.status = 'error' THEN fs.platform END) as error_syncs
            FROM cards c
            LEFT JOIN federation_sync fs ON c.id = fs.card_id
            WHERE c.id IN (${placeholders})
            GROUP BY c.id
        `).all(...cardIds);
    }

    /**
     * Clear sync state for a card
     */
    clearSyncState(cardId, platform = null) {
        const db = getDatabase();
        if (platform) {
            db.prepare('DELETE FROM federation_sync WHERE card_id = ? AND platform = ?').run(cardId, platform);
        } else {
            db.prepare('DELETE FROM federation_sync WHERE card_id = ?').run(cardId);
        }
    }
}

export const federationService = new FederationService();
```

### 2. Federation Routes

**File:** `backend/routes/federation.js`

```javascript
import express from 'express';
import { federationService } from '../services/FederationService.js';
import { getDatabase } from '../database.js';
import { parseCharacterCard } from '../utils/card-parser.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const router = express.Router();

// Get all platform configurations
router.get('/platforms', async (req, res) => {
    try {
        const platforms = federationService.getAllPlatforms();
        // Mask API keys
        const masked = platforms.map(p => ({
            ...p,
            api_key: p.api_key ? '***configured***' : null,
        }));
        res.json({ platforms: masked });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update platform configuration
router.post('/platforms/:platform', async (req, res) => {
    try {
        const { platform } = req.params;
        const { base_url, api_key, enabled } = req.body;

        const updated = federationService.updatePlatformConfig(platform, {
            base_url,
            api_key,
            enabled,
        });

        res.json({
            success: true,
            platform: {
                ...updated,
                api_key: updated.api_key ? '***configured***' : null,
            },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test platform connection
router.post('/platforms/:platform/test', async (req, res) => {
    try {
        const { platform } = req.params;
        const result = await federationService.testConnection(platform);
        res.json(result);
    } catch (error) {
        res.status(500).json({ connected: false, error: error.message });
    }
});

// Get sync state for a card
router.get('/cards/:cardId/sync', async (req, res) => {
    try {
        const { cardId } = req.params;
        const syncStates = federationService.getSyncState(cardId);
        res.json({ cardId, syncStates });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Push card to a platform
router.post('/cards/:cardId/push/:platform', async (req, res) => {
    try {
        const { cardId, platform } = req.params;
        const { overwrite } = req.body;

        const db = getDatabase();
        const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);

        if (!card) {
            return res.status(404).json({ error: 'Card not found' });
        }

        // Get card data from PNG
        const imagePath = path.join(process.cwd(), 'static', 'images', card.imagePath);
        let cardData, imageBuffer;

        try {
            imageBuffer = await fs.readFile(imagePath);
            cardData = await parseCharacterCard(imageBuffer);
        } catch (err) {
            return res.status(500).json({ error: 'Failed to read card data' });
        }

        let result;
        switch (platform) {
            case 'architect':
                result = await federationService.pushToArchitect(cardId, cardData, imageBuffer);
                break;
            case 'sillytavern':
                result = await federationService.pushToSillyTavern(cardId, cardData, imageBuffer, overwrite);
                break;
            default:
                return res.status(400).json({ error: `Unknown platform: ${platform}` });
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk push cards to a platform
router.post('/bulk-push/:platform', async (req, res) => {
    try {
        const { platform } = req.params;
        const { cardIds, overwrite } = req.body;

        if (!Array.isArray(cardIds) || cardIds.length === 0) {
            return res.status(400).json({ error: 'cardIds array required' });
        }

        const results = [];
        for (const cardId of cardIds) {
            try {
                const db = getDatabase();
                const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);

                if (!card) {
                    results.push({ cardId, success: false, error: 'Card not found' });
                    continue;
                }

                const imagePath = path.join(process.cwd(), 'static', 'images', card.imagePath);
                const imageBuffer = await fs.readFile(imagePath);
                const cardData = await parseCharacterCard(imageBuffer);

                let result;
                if (platform === 'architect') {
                    result = await federationService.pushToArchitect(cardId, cardData, imageBuffer);
                } else if (platform === 'sillytavern') {
                    result = await federationService.pushToSillyTavern(cardId, cardData, imageBuffer, overwrite);
                }

                results.push({ cardId, success: true, ...result });
            } catch (error) {
                results.push({ cardId, success: false, error: error.message });
            }
        }

        res.json({
            total: cardIds.length,
            succeeded: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all cards synced to a platform
router.get('/platforms/:platform/cards', async (req, res) => {
    try {
        const { platform } = req.params;
        const { status } = req.query;

        const cards = federationService.getCardsSyncedToPlatform(platform, status);
        res.json({ platform, count: cards.length, cards });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear sync state
router.delete('/cards/:cardId/sync/:platform?', async (req, res) => {
    try {
        const { cardId, platform } = req.params;
        federationService.clearSyncState(cardId, platform || null);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
```

### 3. Register Routes in Server

**Update:** `server.js`

```javascript
import federationRoutes from './backend/routes/federation.js';

// ... existing code ...

// Add federation routes
app.use('/api/federation', federationRoutes);

// Initialize federation tables on startup
import { federationService } from './backend/services/FederationService.js';
await federationService.initTables();
```

---

## Frontend Implementation

### 1. Federation Types

**File:** `frontend/lib/federation-types.ts`

```typescript
export interface FederationPlatform {
    id: number;
    platform: string;
    display_name: string;
    base_url: string | null;
    api_key: string | null;  // Will be masked as '***configured***'
    enabled: number;
    last_connected_at: string | null;
}

export interface SyncState {
    id: number;
    card_id: number;
    platform: string;
    platform_id: string | null;
    last_sync_at: string | null;
    local_hash: string | null;
    remote_hash: string | null;
    status: 'pending' | 'synced' | 'conflict' | 'error';
    error_message: string | null;
    display_name: string;
    base_url: string | null;
    enabled: number;
}

export interface ConnectionTestResult {
    connected: boolean;
    error?: string;
    data?: unknown;
}

export interface PushResult {
    success: boolean;
    remoteId?: string;
    filename?: string;
    error?: string;
}

export interface BulkPushResult {
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
        cardId: string;
        success: boolean;
        remoteId?: string;
        filename?: string;
        error?: string;
    }>;
}
```

### 2. Federation API Functions

**File:** `frontend/lib/federation-api.ts`

```typescript
import type {
    FederationPlatform,
    SyncState,
    ConnectionTestResult,
    PushResult,
    BulkPushResult,
} from './federation-types';

const API_BASE = '';

export async function fetchFederationPlatforms(): Promise<{ platforms: FederationPlatform[] }> {
    const res = await fetch(`${API_BASE}/api/federation/platforms`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch federation platforms');
    return res.json();
}

export async function updateFederationPlatform(
    platform: string,
    config: { base_url?: string; api_key?: string; enabled?: boolean }
): Promise<{ success: boolean; platform: FederationPlatform }> {
    const res = await fetch(`${API_BASE}/api/federation/platforms/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error('Failed to update platform configuration');
    return res.json();
}

export async function testPlatformConnection(platform: string): Promise<ConnectionTestResult> {
    const res = await fetch(`${API_BASE}/api/federation/platforms/${platform}/test`, {
        method: 'POST',
    });
    return res.json();
}

export async function fetchCardSyncState(cardId: string): Promise<{ cardId: string; syncStates: SyncState[] }> {
    const res = await fetch(`${API_BASE}/api/federation/cards/${cardId}/sync`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch sync state');
    return res.json();
}

export async function pushCardToPlatform(
    cardId: string,
    platform: string,
    overwrite: boolean = false
): Promise<PushResult> {
    const res = await fetch(`${API_BASE}/api/federation/cards/${cardId}/push/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwrite }),
    });
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Push failed');
    }
    return res.json();
}

export async function bulkPushToPlatform(
    cardIds: string[],
    platform: string,
    overwrite: boolean = false
): Promise<BulkPushResult> {
    const res = await fetch(`${API_BASE}/api/federation/bulk-push/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds, overwrite }),
    });
    if (!res.ok) throw new Error('Bulk push failed');
    return res.json();
}

export async function clearCardSync(cardId: string, platform?: string): Promise<{ success: boolean }> {
    const url = platform
        ? `${API_BASE}/api/federation/cards/${cardId}/sync/${platform}`
        : `${API_BASE}/api/federation/cards/${cardId}/sync`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear sync state');
    return res.json();
}
```

### 3. Federation Hook

**File:** `frontend/app/hooks/useFederation.ts`

```typescript
import { useState, useCallback } from 'react';
import {
    fetchFederationPlatforms,
    updateFederationPlatform,
    testPlatformConnection,
    fetchCardSyncState,
    pushCardToPlatform,
    bulkPushToPlatform,
} from '@/lib/federation-api';
import type { FederationPlatform, SyncState, ConnectionTestResult, PushResult } from '@/lib/federation-types';

interface UseFederationResult {
    platforms: FederationPlatform[];
    loading: boolean;
    error: string | null;

    // Actions
    loadPlatforms: () => Promise<void>;
    updatePlatform: (platform: string, config: { base_url?: string; api_key?: string; enabled?: boolean }) => Promise<void>;
    testConnection: (platform: string) => Promise<ConnectionTestResult>;

    // Card sync
    getCardSyncState: (cardId: string) => Promise<SyncState[]>;
    pushCard: (cardId: string, platform: string, overwrite?: boolean) => Promise<PushResult>;
    bulkPush: (cardIds: string[], platform: string, overwrite?: boolean) => Promise<void>;

    // Status
    connectionStatus: Record<string, ConnectionTestResult>;
    pushStatus: { cardId: string; platform: string; status: 'pending' | 'success' | 'error'; message?: string } | null;
}

export function useFederation(): UseFederationResult {
    const [platforms, setPlatforms] = useState<FederationPlatform[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionTestResult>>({});
    const [pushStatus, setPushStatus] = useState<UseFederationResult['pushStatus']>(null);

    const loadPlatforms = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { platforms } = await fetchFederationPlatforms();
            setPlatforms(platforms);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load platforms');
        } finally {
            setLoading(false);
        }
    }, []);

    const updatePlatform = useCallback(async (
        platform: string,
        config: { base_url?: string; api_key?: string; enabled?: boolean }
    ) => {
        setLoading(true);
        setError(null);
        try {
            const { platform: updated } = await updateFederationPlatform(platform, config);
            setPlatforms(prev => prev.map(p => p.platform === platform ? updated : p));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update platform');
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    const testConnection = useCallback(async (platform: string): Promise<ConnectionTestResult> => {
        const result = await testPlatformConnection(platform);
        setConnectionStatus(prev => ({ ...prev, [platform]: result }));
        return result;
    }, []);

    const getCardSyncState = useCallback(async (cardId: string): Promise<SyncState[]> => {
        const { syncStates } = await fetchCardSyncState(cardId);
        return syncStates;
    }, []);

    const pushCard = useCallback(async (
        cardId: string,
        platform: string,
        overwrite: boolean = false
    ): Promise<PushResult> => {
        setPushStatus({ cardId, platform, status: 'pending' });
        try {
            const result = await pushCardToPlatform(cardId, platform, overwrite);
            setPushStatus({ cardId, platform, status: 'success', message: result.filename || result.remoteId });
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Push failed';
            setPushStatus({ cardId, platform, status: 'error', message });
            throw err;
        }
    }, []);

    const bulkPush = useCallback(async (
        cardIds: string[],
        platform: string,
        overwrite: boolean = false
    ) => {
        setLoading(true);
        try {
            await bulkPushToPlatform(cardIds, platform, overwrite);
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        platforms,
        loading,
        error,
        loadPlatforms,
        updatePlatform,
        testConnection,
        getCardSyncState,
        pushCard,
        bulkPush,
        connectionStatus,
        pushStatus,
    };
}
```

### 4. Federation Settings Modal

**File:** `frontend/app/components/FederationModal.tsx`

```tsx
'use client';

import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, Loader2, Check, AlertCircle, RefreshCw, Cloud, Server, Globe } from 'lucide-react';
import clsx from 'clsx';
import { useFederation } from '../hooks/useFederation';
import type { FederationPlatform } from '@/lib/federation-types';

interface FederationModalProps {
    show: boolean;
    onClose: () => void;
}

const PLATFORM_ICONS: Record<string, typeof Cloud> = {
    architect: Server,
    sillytavern: Cloud,
    hub: Globe,
};

const PLATFORM_COLORS: Record<string, string> = {
    architect: 'indigo',
    sillytavern: 'emerald',
    hub: 'purple',
};

export function FederationModal({ show, onClose }: FederationModalProps) {
    const {
        platforms,
        loading,
        error,
        loadPlatforms,
        updatePlatform,
        testConnection,
        connectionStatus,
    } = useFederation();

    const [editingPlatform, setEditingPlatform] = useState<string | null>(null);
    const [formData, setFormData] = useState<Record<string, { base_url: string; api_key: string; enabled: boolean }>>({});
    const [testing, setTesting] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<{ platform: string; type: 'success' | 'error'; message: string } | null>(null);

    useEffect(() => {
        if (show) {
            loadPlatforms();
        }
    }, [show, loadPlatforms]);

    useEffect(() => {
        // Initialize form data from platforms
        const data: typeof formData = {};
        platforms.forEach(p => {
            data[p.platform] = {
                base_url: p.base_url || '',
                api_key: '', // Don't pre-fill masked key
                enabled: Boolean(p.enabled),
            };
        });
        setFormData(data);
    }, [platforms]);

    const handleTest = async (platform: string) => {
        setTesting(platform);
        try {
            await testConnection(platform);
        } finally {
            setTesting(null);
        }
    };

    const handleSave = async (platform: string) => {
        const data = formData[platform];
        if (!data) return;

        try {
            await updatePlatform(platform, {
                base_url: data.base_url || undefined,
                api_key: data.api_key || undefined,
                enabled: data.enabled,
            });
            setSaveStatus({ platform, type: 'success', message: 'Saved!' });
            setEditingPlatform(null);
            setTimeout(() => setSaveStatus(null), 2000);
        } catch (err) {
            setSaveStatus({
                platform,
                type: 'error',
                message: err instanceof Error ? err.message : 'Save failed',
            });
        }
    };

    const renderPlatformCard = (platform: FederationPlatform) => {
        const Icon = PLATFORM_ICONS[platform.platform] || Cloud;
        const color = PLATFORM_COLORS[platform.platform] || 'gray';
        const isEditing = editingPlatform === platform.platform;
        const data = formData[platform.platform] || { base_url: '', api_key: '', enabled: false };
        const status = connectionStatus[platform.platform];
        const isTesting = testing === platform.platform;
        const platformSaveStatus = saveStatus?.platform === platform.platform ? saveStatus : null;

        return (
            <div
                key={platform.platform}
                className={clsx(
                    'rounded-2xl border p-4 transition-all',
                    data.enabled
                        ? `border-${color}-200 bg-${color}-50/50 dark:border-${color}-800 dark:bg-${color}-900/20`
                        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                )}
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className={clsx(
                            'rounded-xl p-2',
                            data.enabled
                                ? `bg-${color}-100 text-${color}-600 dark:bg-${color}-900/50 dark:text-${color}-400`
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                        )}>
                            <Icon className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {platform.display_name}
                            </h3>
                            {platform.last_connected_at && (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Last connected: {new Date(platform.last_connected_at).toLocaleString()}
                                </p>
                            )}
                        </div>
                    </div>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={data.enabled}
                            onChange={(e) => setFormData(prev => ({
                                ...prev,
                                [platform.platform]: { ...data, enabled: e.target.checked },
                            }))}
                            className={clsx(
                                'h-4 w-4 rounded',
                                `text-${color}-600 focus:ring-${color}-500`
                            )}
                        />
                        <span className="text-sm text-slate-600 dark:text-slate-300">Enabled</span>
                    </label>
                </div>

                {/* Connection Status */}
                {status && (
                    <div className={clsx(
                        'flex items-center gap-2 text-sm mb-3 px-3 py-2 rounded-lg',
                        status.connected
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    )}>
                        {status.connected ? (
                            <Check className="h-4 w-4" />
                        ) : (
                            <AlertCircle className="h-4 w-4" />
                        )}
                        {status.connected ? 'Connected' : status.error || 'Connection failed'}
                    </div>
                )}

                {/* Form Fields */}
                <div className="space-y-3">
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-slate-700 dark:text-slate-300">Base URL</span>
                        <input
                            type="text"
                            value={data.base_url}
                            onChange={(e) => setFormData(prev => ({
                                ...prev,
                                [platform.platform]: { ...data, base_url: e.target.value },
                            }))}
                            placeholder={
                                platform.platform === 'sillytavern'
                                    ? 'http://localhost:8000'
                                    : platform.platform === 'architect'
                                    ? 'http://localhost:3000'
                                    : 'https://api.cardshub.example.com'
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                        />
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                            API Key {platform.api_key && <span className="text-slate-400">(configured)</span>}
                        </span>
                        <input
                            type="password"
                            value={data.api_key}
                            onChange={(e) => setFormData(prev => ({
                                ...prev,
                                [platform.platform]: { ...data, api_key: e.target.value },
                            }))}
                            placeholder="Leave blank to keep existing"
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                        />
                    </label>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <button
                        onClick={() => handleTest(platform.platform)}
                        disabled={isTesting || !data.base_url}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
                    >
                        {isTesting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                        Test Connection
                    </button>

                    <div className="flex items-center gap-2">
                        {platformSaveStatus && (
                            <span className={clsx(
                                'text-sm',
                                platformSaveStatus.type === 'success' ? 'text-green-600' : 'text-red-600'
                            )}>
                                {platformSaveStatus.message}
                            </span>
                        )}
                        <button
                            onClick={() => handleSave(platform.platform)}
                            disabled={loading}
                            className={clsx(
                                'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition',
                                `bg-${color}-600 hover:bg-${color}-500`
                            )}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Save
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <Transition.Root show={show} as={Fragment}>
            <Dialog onClose={onClose} className="relative z-50">
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
                </Transition.Child>

                <div className="fixed inset-0 flex items-center justify-center p-4">
                    <Transition.Child
                        as={Fragment}
                        enter="ease-out duration-300"
                        enterFrom="opacity-0 scale-95"
                        enterTo="opacity-100 scale-100"
                        leave="ease-in duration-200"
                        leaveFrom="opacity-100 scale-100"
                        leaveTo="opacity-0 scale-95"
                    >
                        <Dialog.Panel className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
                                <Dialog.Title className="text-xl font-bold text-slate-900 dark:text-white">
                                    Federation Settings
                                </Dialog.Title>
                                <button
                                    onClick={onClose}
                                    className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="overflow-y-auto max-h-[calc(90vh-8rem)] px-6 py-6">
                                {error && (
                                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                                        {error}
                                    </div>
                                )}

                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                                    Configure connections to sync cards between Character Archive and other platforms.
                                    Enable a platform and provide its URL to start syncing.
                                </p>

                                <div className="space-y-4">
                                    {platforms.map(renderPlatformCard)}
                                </div>
                            </div>
                        </Dialog.Panel>
                    </Transition.Child>
                </div>
            </Dialog>
        </Transition.Root>
    );
}
```

### 5. Add to Main Page

**Update:** `frontend/app/page.tsx`

```tsx
// Add import
import { FederationModal } from './components/FederationModal';

// Add state
const [showFederation, setShowFederation] = useState(false);

// Add button in header/toolbar (near settings)
<button
    onClick={() => setShowFederation(true)}
    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
>
    <Cloud className="h-4 w-4" />
    Federation
</button>

// Add modal
<FederationModal
    show={showFederation}
    onClose={() => setShowFederation(false)}
/>
```

---

## Card Actions Update

Add federation sync buttons to the CardModal:

**Update:** `frontend/app/components/CardModal.tsx`

Add a "Sync to..." dropdown or buttons:

```tsx
// Import
import { useFederation } from '../hooks/useFederation';

// In component
const { pushCard, pushStatus, platforms } = useFederation();

// Add sync buttons near existing push button
<div className="flex gap-2">
    {platforms.filter(p => p.enabled).map(platform => (
        <button
            key={platform.platform}
            onClick={() => pushCard(card.id, platform.platform)}
            disabled={pushStatus?.cardId === card.id && pushStatus?.status === 'pending'}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
            {pushStatus?.cardId === card.id && pushStatus?.platform === platform.platform ? (
                pushStatus.status === 'pending' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : pushStatus.status === 'success' ? (
                    <Check className="h-4 w-4" />
                ) : (
                    <AlertCircle className="h-4 w-4" />
                )
            ) : null}
            Sync to {platform.display_name}
        </button>
    ))}
</div>
```

---

## Migration Path

To migrate from existing `pushCardToSilly` and `pushCardToArchitect`:

1. **Keep existing functions working** during transition
2. **Add sync state tracking** to existing push functions
3. **Gradually replace** with federation service calls
4. **Deprecate old endpoints** once federation is stable

---

## Future Enhancements

1. **Pull from platforms** - Fetch cards from CA/ST into Archive
2. **Conflict resolution UI** - Show diffs, choose version
3. **Auto-sync on changes** - Watch for local changes, push automatically
4. **Sync history** - Log all sync operations
5. **Bulk operations UI** - Select multiple cards, sync all at once
6. **CardsHub integration** - Full public hub support

---

## Related Files

- Character Architect Federation: `/mnt/samesung/ai/card_doctor/FEDERATION-IMPLEMENTATION.md`
- SillyTavern CForge Plugin: `/mnt/samesung/ai/SillyTavern/plugins/SillyTavern-CForge/`
- Federation Package: `/home/vega/ai/card-ecosystem/character-foundry/packages/federation/`
