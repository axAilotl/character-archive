# 1214_xhigh_results.md

Date: 2025-12-14  
Scope: “Local-only” home-server archive; reliability + resumability prioritized over speed.

## P0 — Persistent SQLite Job Queue (Phase 2)

**Problem**
- Long-running work (sync/import/vector/backfills) is started ad-hoc (SSE endpoints and `setInterval`). If the server restarts, you lose progress/state. Concurrency control is in-memory only.

**Goal**
- Make background work *persistent, resumable, observable, cancelable*.

**Proposed Approach**
- Add a SQLite-backed `jobs` table and a single “worker loop” that claims jobs using a lease (`locked_at`, `lock_expires_at`, `locked_by`).
- Store progress as JSON in the DB so UI/SSE can reconnect and keep updating.
- First migrate these “heavy” operations to jobs:
  1) Chub sync, 2) CT sync, 3) Wyvern/Risu sync, 4) vector backfill, 5) bulk refresh/backfills.
- Convert auto-update timers to *enqueue jobs* (not run jobs inline). Keep scheduler, but make it “enqueue-only”.

**Files / Surfaces**
- `backend/db/schema.js` (new `jobs` table + indexes)
- `backend/db/repositories/JobRepository.js` (claim/update/progress/fail/succeed)
- `backend/services/JobQueueService.js` + `backend/services/JobWorkerService.js` (execution + leasing)
- `backend/routes/jobs.js` + `backend/controllers/JobController.js` (enqueue/status/cancel)
- `backend/controllers/SyncController.js` + `backend/services/SchedulerService.js` (migrate to queue)
- Frontend: `frontend/app/hooks/useSync.ts` (consume job status via SSE/poll)

**Acceptance Criteria**
- Restart server mid-job → job resumes or is marked failed with error details.
- UI can reconnect and continue showing progress (job ID-based).
- Cancel works: job stops and ends `status=canceled`.

---

## P1 — Make “Home Server” Access Actually Work (IP/Proxy Policy)

**Problem**
- `server.js` binds to LAN-capable host (`0.0.0.0`), but blocks all non-loopback IPs via a hardcoded IP allowlist.

**Fix**
- Move access policy to `config.json`:
  - `network.allowedCidrs` (default: loopback + RFC1918 LAN ranges) **or**
  - `network.localOnly=true` (forces localhost bind + loopback allow only).
- If you run behind a reverse proxy, make this explicit and safe:
  - `app.set('trust proxy', ...)` only when configured.
  - Use `X-Forwarded-For` only when `trust proxy` is enabled.

**Files**
- `server.js`
- `config.js` (validation + defaults)

---

## P2 — Unify Chub API Key Naming (`apikey` vs `chubApiKey`)

**Problem**
- Multiple fields are used for the same credential:
  - Timeline/config checks reference `apikey`
  - Scrapers and other services often reference `chubApiKey`
  - `scripts/sync.js` checks `apikey`, while main scraper checks `chubApiKey`
- Result: “config looks set” but sync/script fails depending on which field the user filled.

**Fix**
- Pick **one** canonical field (recommend: `chubApiKey`) and treat the other as legacy alias.
- In `loadConfig()` normalize:
  - If `apikey` is set and `chubApiKey` is empty → copy it into `chubApiKey`.
  - Optionally also mirror back on save for backward compatibility (or migrate once).
- Update all call sites and validation to use the canonical field.

**Files**
- `config.js`
- `backend/controllers/ConfigController.js`
- `backend/services/scraper.js`
- `backend/services/SyncService.js`
- `scripts/sync.js`
- `frontend/app/hooks/useConfig.ts` (ensure UI writes the canonical field)

---

## P3 — Advanced Search Text Mismatch (Meilisearch ignores `query`)

**Problem**
- Backend Meilisearch calls use `params.advancedText`, but frontend always sends `advanced=true` with `query` (not `advancedText`).
- Effect: “advanced search enabled” but Meili receives an empty query string; results become filter-only or wrong.

**Fix**
- In advanced search, use one unified `queryText = advancedText || query`.
- Pass `queryText` to both lexical and vector searches when available.

**Files**
- `backend/services/CardQueryService.js`
- `frontend/app/hooks/useCardData.ts` (optional: also send `advancedText=query` for clarity)

---

## P4 — Tag Edits Don’t Update `card_tags` (SQL tag search becomes inconsistent)

**Problem**
- `POST /api/cards/:cardId/tags` updates `cards.topics` but does not rebuild the normalized tag table.
- SQL “include/exclude tag” filters rely on `card_tags`, so results can drift until a rebuild.

**Fix**
- After writing topics, call `replaceCardTags(cardId, topicsArray)` (or a service wrapper).
- Invalidate cached query results.

**Files**
- `backend/controllers/CardController.js`
- `backend/db/repositories/TagRepository.js`

---

## P5 — `backfillTokenCounts()` in `CardRepository` References Missing Imports

**Problem**
- `backend/db/repositories/CardRepository.js` uses `TOKEN_COUNT_COLUMNS` and `resolveTokenCountsFromMetadata` without importing them → runtime error / dead code path.

**Fix**
- Import from `backend/utils/token-counts.js` and ensure logic matches the “labels vs tokenCounts” behavior you want.
- Align with admin backfill endpoint to avoid duplicate/parity drift.

**Files**
- `backend/db/repositories/CardRepository.js`
- `backend/utils/token-counts.js`
- `backend/controllers/AdminController.js`

---

## P6 — Federation: Missing DB Tables + Fetch Timeout Bug

**Problem**
- Federation routes and service assume tables that schema doesn’t create (`federation_platforms`, `federation_sync`).
- `fetch(actorUrl, { timeout: 5000 })` does not actually time out in Node’s fetch.

**Fix**
- Add required tables to schema + light migration/init rows for known platforms.
- Replace fetch “timeout” with `AbortController` + `signal`.

**Files**
- `backend/db/schema.js`
- `backend/routes/federation.js`
- `backend/services/FederationService.js`

---

## P7 — Consistent Scraper Verbosity + Log Levels (Make all scrapers “Chub-grade”, but controllable)

**Goal**
- Keep Chub’s rich visibility, but gate per-card/per-request noise behind `LOG_LEVEL=DEBUG`.

**Fix**
- Replace `console.log`/`console.warn` in background paths with `logger.scoped(...)` across scrapers and scheduler.
- Standardize progress events across scrapers:
  - INFO: phase changes, page boundaries, “every N items”
  - DEBUG: per-card details, request/response metadata, retries
- Ensure all scrapers accept `(config, progressCallback)` with consistent payload shape.

**Files**
- `backend/services/SchedulerService.js` (currently very `console.log` heavy)
- `backend/services/scraper.js` (baseline pattern)
- `backend/services/scrapers/*.js` (Wyvern/Risu/CT/Chub)
- `backend/utils/logger.js` (if you want per-scope overrides later)

---

## P8 — Asset Cache Redirect SSRF Hardening

**Problem**
- Asset downloads validate the initial hostname but don’t re-validate redirect targets.

**Fix**
- Disable redirects or re-validate final URL after redirects.
- Set `maxRedirects: 0` (strict) or manually follow with allowlist checks.

**Files**
- `backend/services/asset-cache.js`

---

## P9 — Dev Ergonomics: Ignore Meilisearch Data Dir for Tools

**Problem**
- Repo contains `data.ms/` with restricted permissions; tools like ripgrep can throw permission errors.

**Fix**
- Add `data.ms/` to `.gitignore` (and/or a `.rgignore`) so searches don’t traverse it.

**Files**
- `.gitignore`

