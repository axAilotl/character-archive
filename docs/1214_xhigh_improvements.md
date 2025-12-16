# 1214_xhigh_improvements.md

Date: 2025-12-14  
Focus: New features + structural improvements (local home server, background archive).

## 1) Moderation / Bulk Wipe (Boolean rules using existing Meilisearch syntax)

### Core idea: “Rules = saved Meili searches”
Instead of inventing a new DSL, store purge/deny rules as:
- `queryText` (optional)
- `filterExpr` (Meilisearch filter expression; supports boolean logic + parentheses)
- `scope` (`preview`, `purge`, `deny`)
- `action` (`quarantine`, `delete`, `delete+blacklist`)
- `enabled` + metadata (`createdAt`, `lastRunAt`, `notes`)

This lets you express complex logic like:
- `(tags = "furry" OR tags = "vore") AND NOT (tags = "sfw")`
- `source = "chub" AND author = "somecreator"`
- `tokenCount >= 2000 AND (hasLorebook = true OR hasAlternateGreetings = true)`

### UI: Moderation console
Add a `/moderation` page that reuses the Advanced Search inputs:
- **Preview**: show total count + a small sample list of cards.
- **Dry run**: store a report (counts by source/tag/author).
- **Execute purge**: runs a background purge job over the matched IDs.
  - Option: “Quarantine first” (move files + mark DB state) vs hard delete.
  - Option: “Also add creators/tags to deny lists”.

### “Universal blocked tags” + “per-platform blocked creators”
You asked for:
- **Blocked tags universal**: one global list (canonicalized via tag aliases + lowercase).
- **Blocked creators per platform**: e.g. chub creators separate from CT creators.

Proposed config shape (or tables; see below):
```json
{
  "moderation": {
    "blockedTags": ["furry", "vore"],
    "blockedCreatorsBySource": {
      "chub": ["creator_a", "creator_b"],
      "ct": ["some_ct_author"],
      "risuai": [],
      "wyvern": []
    }
  }
}
```

### Card modal actions
Add quick actions to the card modal:
- **Block creator** (source-scoped)
  - `source = "<card.source>" AND author = "<author>"`
  - optional “Block + purge existing”
- **Block tag** (global)
  - `tags = "<tag>"`
  - optional “Block + purge existing”

### Storage: move off flat files
Right now there are multiple “lists” (`blacklist.txt`, `ct-blacklist.txt`, plus config fields). For auditability and undo:
- Create SQLite tables for deny/allow lists and purge rules, export/import to text as a convenience.

Suggested tables:
- `moderation_rules(id, name, enabled, query_text, filter_expr, action, created_at, updated_at)`
- `moderation_blocked_tags(tag PRIMARY KEY, created_at, source_rule_id, notes)`
- `moderation_blocked_creators(source, creator, created_at, source_rule_id, notes, PRIMARY KEY(source, creator))`
- `moderation_actions_log(id, rule_id, action, matched_count, deleted_count, quarantined_count, started_at, finished_at, status, error)`

## 2) Scraper Plug‑In Architecture (easy to add new sources)

### Single contract for all scrapers
Define a uniform “scraper plugin” interface:
- `source` (id; `chub|ct|risuai|wyvern|...`)
- `displayName`
- `capabilities` (`discover`, `refreshById`, `supportsBlockedCreators`, etc.)
- `getConfigSchema()` (or a validation function)
- `sync(config, ctx)` and optional `refresh(id, ctx)`

### Shared context = consistency without copy/paste
Every scraper gets:
- `ctx.log` (scoped logger)
- `ctx.progress({progress, phase, processed, added, skipped, currentId, currentName})`
- `ctx.abortSignal` (cancel)
- `ctx.moderation` (blocked tags + blocked creators for this source)
- `ctx.db` and helper services (asset cache, tag normalizer, etc.)

This keeps scrapers “Chub-grade” in capability, while letting you control verbosity using `LOG_LEVEL`:
- INFO: phase/page milestones, “every N processed”
- DEBUG: per-card details, request/response + retries

### Registry-driven wiring (no one-off endpoints)
Make sync endpoints call a registry:
- `/api/sync/:source` → `ScraperRegistry.get(source).sync(...)`
- Scheduler enqueues “sync job for source X”
- UI just lists sources returned by registry

That way “add new scraper” becomes:
1) drop file/package, 2) register, 3) add config panel (optional), 4) done.

### Testing harness for scrapers
Add fixtures support:
- store small sample payloads (HTML/JSON) for each source
- run `node scripts/test-scraper.js --source <x> --fixture <y>`
This prevents “site changed slightly → scraper silently breaks”.

## 3) Federation (future-proof integration)

You noted federation lives in a separate package. Keep your app clean by:
- Wrapping the federation package behind a single `FederationBridgeService` (no direct package calls from controllers).
- Making federation push/pull operations run via the job queue (retry/backoff, history, cancellation).
- Storing platform configs + sync state in SQLite (single backup surface).

UI improvements:
- “Push to platform” should show last sync status + error reason + retry button.
- “Bulk push” should use the same job infrastructure and allow partial failure reporting.

## 4) Quality-of-life improvements (small, high impact)

- Add “Saved moderation rules” and “Run nightly purge” (enqueue job at off-hours).
- Add “Creator/tag management” screen with counts and quick purge buttons (powered by Meili).
- Add “Quarantine browser” (review + restore + permanently delete).
- Make tag alias + canonical tag set visible in UI (helps build stable rules like `tags = "vore"` even when variants exist).

