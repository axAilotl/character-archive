# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Character Archive is a web application for scraping, caching, and browsing AI character cards from multiple sources: Chub.ai, Character Tavern, RisuAI, and Wyvern. The project includes both a legacy Python version (`localchub.py`) and a modern Node.js rewrite with 10-100x better performance. The Node.js version is the active codebase.

**Architecture**: Express backend (Node.js) + Next.js 15 / React 19 frontend
- **Backend (API)**: Node.js with Express serving REST API, SQLite database (WAL mode, better-sqlite3), ES modules with four-space indent
- **Frontend**: Next.js 15 with React 19, TypeScript, Tailwind CSS, client-side main component (`app/page.tsx`)
- **Database**: SQLite with better-sqlite3 package, WAL mode for concurrent reads, automatic schema migrations
- **Search**: Optional Meilisearch integration for advanced full-text search with OR/AND/NOT queries
- **Vector Search**: Optional vector search via Ollama embeddings for semantic similarity
- **Card sync**: Four sources - Chub.ai, Character Tavern, RisuAI, and Wyvern
- **Static data**: Card PNG/JSON pairs in `static/<id_prefix>/`

## Development Commands

### Backend (from root)
```bash
# Development mode (auto-reload both backend and frontend)
npm run dev

# Backend only (with nodemon)
npm run dev:api

# Production mode
npm start

# One-time card sync from all sources
npm run sync

# Sync Meilisearch index with database
npm run sync:search

# Backfill vector embeddings
npm run vector:backfill

# Flush vector indexes
npm run vector:flush
```

### Frontend (from /frontend)
```bash
# Development mode
npm run dev

# Production build
npm run build

# Start production server
npm start
```

### Scripts
```bash
# Import Character Tavern cards
npm run import:ct

# Update card metadata from JSON files
npm run update-metadata

# Fix feature flags in database
npm run fix:flags
```

## High-Level Architecture

### Backend Structure

The backend follows a modular MVC-like pattern:

```
backend/
├── controllers/        # Route handlers (thin, delegate to services)
├── db/
│   ├── connection.js   # Database connection (better-sqlite3)
│   ├── schema.js       # Table definitions
│   └── repositories/   # Data access layer
├── routes/             # Express route definitions
├── services/           # Business logic
│   ├── scrapers/       # Source-specific scrapers (Chub, CT, RisuAI, Wyvern)
│   ├── ConfigState.js  # Configuration singleton
│   ├── MetricsService.js # Metrics & snapshots
│   ├── SchedulerService.js # Background jobs
│   └── LockService.js  # Sync lock management
└── utils/              # Shared utilities (logger, card-utils)
```

### Backend Core Modules

**server.js**: Main Express server (entry point)
- Wires helmet, compression, morgan middleware; loads runtime config
- Initializes SQLite through `backend/database.js`
- REST API endpoints: `/api/cards`, `/api/tags`, `/api/config`, `/api/sync`, `/api/metrics`, `/api/federation`
- Security: IP whitelist (localhost only), helmet, compression, rate limiting
- Starts scheduled jobs: auto-sync, metrics snapshots, WAL checkpoint

**backend/db/connection.js**: SQLite connection
- Uses better-sqlite3 for synchronous, high-performance queries
- WAL mode enabled for concurrent reads during writes
- Optimized PRAGMAs: 64MB cache, 2GB mmap_size, synchronous=NORMAL
- Hourly WAL checkpoint via SchedulerService

**backend/services/scrapers/**: Multi-source scrapers
- `ChubScraper.js`: Chub.ai Timeline/Search API with anti-fuzz protection
- `CtScraper.js`: Character Tavern Meilisearch index
- `RisuAiScraper.js`: RisuAI API with character downloads
- `WyvernScraper.js`: Wyvern.chat API

**backend/services/MetricsService.js**: Metrics and analytics
- `getCurrentMetrics()`: Real-time stats from database
- `getTopTags(limit)`: Most popular tags
- `getTrendingTags(limit)`: Tags with biggest increases vs yesterday
- `getTopCardsPerPlatform(limit)`: Top cards by platform (stars/chats)
- `getTokenDistribution()`: Histogram buckets for token counts
- `computeDailySnapshot()`: Store daily metrics snapshot

**backend/services/SchedulerService.js**: Background jobs
- Auto-sync for Chub and CT (configurable intervals)
- Search index queue drain (every 5 seconds)
- Daily metrics snapshot (at midnight)
- WAL checkpoint (hourly) to prevent WAL file growth
- Metrics snapshot cleanup (90-day retention policy, runs on startup and after daily snapshots)

**backend/services/search-index.js**: Meilisearch integration
- `configureSearchIndex()`: Initialize client, set filterable/sortable fields
- `searchMeilisearchCards()`: Advanced search with filters, sorting, federation for OR queries
- Supports complex queries: quoted phrases, AND/OR/NOT, field filters
- Queue-based indexing with batch processing

### Frontend Architecture (Next.js 15 / React 19)

**frontend/app/page.tsx**: Main UI component (`"use client"` entry point)
- Single-page React app with heavy hook usage (useState, useEffect, useSearchParams)
- Uses SWR for data fetching with revalidation
- Card grid with pagination (sticky header arrows + footer numbered pager)
- Filter UI: tags, language, favorites, search modes, source filter (All/Chub/CT/RisuAI/Wyvern)
- Advanced search toggle for Meilisearch queries
- Card actions: favorite, delete, import to SillyTavern, cache assets
- Settings modal with per-source sync buttons

**frontend/app/metrics/page.tsx**: Metrics dashboard
- Overview cards (total cards, tokens, new this week, favorited)
- Pie chart: Cards by Source (Recharts)
- Bar chart: Token Distribution histogram
- Area chart: Cards Added Over Time (30 days)
- Horizontal bar chart: Top 15 Tags
- Trending tags section (with change indicators)
- Top 5 cards per platform grid

**frontend/lib/api.ts**: API fetch helpers
- Wraps all backend calls with consistent error handling
- SSE-based sync functions for each source
- Metrics fetch functions with TypeScript interfaces

**frontend/app/hooks/useSync.ts**: Sync state management
- Generic `useSyncSource` hook handles SSE streams, AbortControllers, and status for any sync source
- `useSync` hook composes individual source hooks (Chub, CT, Wyvern, RisuAI)
- Efficient polling: only polls `/api/sync/status` when a sync is active (single check on mount otherwise)
- Exposes per-source start/cancel functions plus global `cancelAllSyncs`

### Data Flow

1. **Sync Process**:
   - User triggers sync via UI or auto-sync timer
   - Scraper fetches cards from API (Chub/CT/RisuAI/Wyvern)
   - PNG files downloaded to `static/{first-2-digits-of-id}/{id}.png`
   - Metadata extracted and saved to `static/{first-2-digits-of-id}/{id}.json`
   - `CardRepository.upsertCard()` inserts/updates SQLite database
   - If Meilisearch enabled, cards queued for indexing

2. **Search Process**:
   - User inputs search query in frontend
   - Frontend calls `/api/cards` with query params
   - Backend checks `useAdvancedSearch` flag:
     - If true: `searchMeilisearchCards()` with advanced filters
     - If false: SQL LIKE queries with tag expansion
   - Results returned with pagination metadata

3. **Metrics Collection**:
   - Daily snapshot computed at midnight via SchedulerService
   - Real-time metrics available via `/api/metrics/stats`
   - Historical data tracked in `metrics_snapshots` table (90-day retention)

### Key Database Schema

**cards table** (SQLite, WAL mode):
```sql
id TEXT PRIMARY KEY
-- Source tracking (multi-source support)
source TEXT DEFAULT 'chub'  -- 'chub', 'ct', 'risuai', 'wyvern'
sourceId TEXT               -- Original ID from source
sourcePath TEXT             -- e.g., 'author/slug'
sourceUrl TEXT              -- Deep link to source

-- Core metadata
author TEXT
name TEXT
tagline TEXT
description TEXT
topics TEXT                 -- JSON array of tags

-- Metrics
tokenCount INTEGER
nChats INTEGER
nMessages INTEGER
starCount INTEGER
rating REAL

-- Feature flags
hasAlternateGreetings INTEGER (0/1)
hasLorebook INTEGER (0/1)
hasEmbeddedLorebook INTEGER (0/1)
hasExampleDialogues INTEGER (0/1)
hasSystemPrompt INTEGER (0/1)
hasGallery INTEGER (0/1)
hasExpressionPack INTEGER (0/1)
```

**metrics_snapshots table**:
```sql
id INTEGER PRIMARY KEY
snapshot_date TEXT          -- YYYY-MM-DD
metric_type TEXT            -- 'daily', 'weekly', etc.
data TEXT                   -- JSON blob with metrics
created_at TEXT
```

### Configuration

**config.json** structure:
```json
{
  "autoUpdateMode": boolean,
  "autoUpdateInterval": seconds,
  "port": number,
  "ip": string,
  "apikey": string,              // Chub.ai API key (REDACTED in /api/config)
  "use_timeline": boolean,

  "meilisearch": {
    "enabled": boolean,
    "host": "http://localhost:7700",
    "apiKey": string,
    "indexName": "cards"
  },

  "vectorSearch": {
    "enabled": boolean,
    "ollamaHost": "http://localhost:11434",
    "model": "nomic-embed-text"
  },

  "sillyTavern": {
    "enabled": boolean,
    "baseUrl": "http://localhost:8000"
  },

  "ctSync": {
    "enabled": boolean,
    "intervalMinutes": number
  },

  "risuaiSync": {
    "enabled": boolean,
    "intervalMinutes": number
  },

  "wyvernSync": {
    "enabled": boolean,
    "intervalMinutes": number
  }
}
```

## Important Implementation Details

### Security
- IP whitelist: Only localhost (127.0.0.1, ::1, ::ffff:127.0.0.1) allowed
- Config endpoint redacts sensitive keys (apikey, tokens, passwords)
- Card ID validation: Must match `/^\d+$/` pattern (path traversal protection)
- Rate limiting on API routes (skipped for localhost)

### Database Performance
- better-sqlite3 for synchronous, high-performance queries
- WAL mode with hourly checkpoint (via SchedulerService)
- mmap_size: 2GB (reduced from 30GB to prevent OOM)
- cache_size: 64MB
- Indexes on: topics, author, name, language, favorited, visibility, source

### PNG Metadata & Anti-Fuzz
- Card data embedded in PNG tEXt chunks with key "chara" (Base64-encoded JSON)
- Anti-fuzz protection: validates PNG structure before saving
- On fuzzed downloads: keeps existing PNGs when new downloads are invalid

### Multi-Source Architecture
Each source has its own scraper in `backend/services/scrapers/`:
- **Chub**: Timeline API (requires API key) or Search API (public)
- **CT**: Meilisearch index at search.character-tavern.com
- **RisuAI**: REST API with dynamic file format handling
- **Wyvern**: REST API with pagination

All scrapers:
- Set `source`, `sourceId`, `sourcePath`, `sourceUrl` columns
- Emit progress via SSE for frontend status updates
- Support cancellation via AbortController
- Use LockService to prevent concurrent syncs

Source URL generation is centralized in `CardRepository.js` via `SOURCE_URL_CONFIG`:
- Each source defines a `domain` and `buildUrl` function
- Adding new sources only requires adding an entry to the config object
- Automatically resolves correct URLs during card upsert

## File Organization

```
/
├── server.js                     # Express server entry point
├── config.js                     # Config loader
├── backend/
│   ├── database.js               # Database initialization
│   ├── db/
│   │   ├── connection.js         # SQLite connection
│   │   ├── schema.js             # Table definitions
│   │   └── repositories/         # Data access layer
│   ├── controllers/              # Route handlers
│   ├── routes/                   # Express routes
│   ├── services/
│   │   ├── scrapers/             # Source scrapers
│   │   ├── MetricsService.js     # Metrics
│   │   ├── SchedulerService.js   # Background jobs
│   │   └── search-index.js       # Meilisearch
│   └── utils/                    # Utilities
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Main UI
│   │   ├── metrics/page.tsx      # Metrics dashboard
│   │   └── hooks/
│   │       └── useSync.ts        # Sync state management hook
│   └── lib/api.ts                # API helpers
├── scripts/                      # Maintenance scripts
├── static/                       # Card images/JSON (USER DATA)
└── config.json                   # Runtime config (USER DATA)
```

## Coding Style & Conventions

**Backend (ES modules only)**:
- Four-space indent, single quotes
- Keep Express handlers thin—delegate to services
- Prefer synchronous better-sqlite3 APIs
- Never inline tokens—use config.json

**Frontend**:
- TypeScript + React hooks
- Components follow PascalCase
- Styling is Tailwind-first
- Lint with `npm run lint --prefix frontend`

## API Reference

### Core Endpoints

**GET /api/cards** - List cards with filters
**GET /api/cards/:id/metadata** - Card metadata JSON
**GET /api/cards/:id/png-info** - PNG embedded metadata
**POST /api/cards/:id/refresh** - Re-download single card

**GET /api/metrics/stats** - Comprehensive stats
**GET /api/metrics/top-tags** - Top tags with counts
**GET /api/metrics/trending-tags** - Tags with biggest increases
**GET /api/metrics/top-cards-by-platform** - Top 5 per platform
**GET /api/metrics/distribution** - Token histogram
**GET /api/metrics/timeline** - Cards over time

**GET /api/sync/cards** (SSE) - Chub sync progress
**GET /api/sync/ct** (SSE) - CT sync progress
**GET /api/sync/risuai** (SSE) - RisuAI sync progress
**GET /api/sync/wyvern** (SSE) - Wyvern sync progress

**GET /api/config** - Get config (sensitive keys redacted)
**POST /api/config** - Update configuration

### Search & Pagination

- **Tag filtering**: `include` param (comma-separated), `tagMatchMode=and|or`
- **Advanced search**: `useAdvancedSearch=true` uses Meilisearch
- **Source filter**: `source` param (all|chub|ct|risuai|wyvern)
- **Pagination**: `page`, `pageSize` params

## Common Gotchas

1. **Port conflicts**: Backend defaults to 6969, frontend to 3177.
2. **Database locked errors**: Usually self-resolving. WAL checkpoint runs hourly.
3. **PNG validation failures**: Requires sharp module.
4. **Timeline API requires API key**: Set `apikey` in config.json.
5. **Meilisearch connection**: Verify host/port. Default is localhost:7700.
