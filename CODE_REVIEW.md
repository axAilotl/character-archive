# Code Review: Character Archive

**Date:** 2025-12-03
**Reviewer:** Gemini (Current)
**Previous Review:** Claude Code (Opus 4.5) - 2025-11-25

---

## Overall Assessment

The project maintains a strong architectural foundation with clear separation of concerns. Significant progress has been made since the last review, particularly in frontend refactoring and backend logic corrections. The recent addition of the Linked Lorebook download feature demonstrated good adherence to modular design principles by introducing a dedicated service and refactoring shared API logic.

---

## Status of Previous Issues

| Issue | Status | Notes |
| :--- | :--- | :--- |
| **1. Dead Code in `CardController.deleteCard`** | **FIXED** | Logic was corrected to fetch source info *before* deletion, ensuring blacklist updates work for CT cards. |
| **2. Potential SQL Injection (Table Names)** | **CLOSED** | Reviewed as False Positive. `CARD_TAGS_TABLE_NAME` is a constant string literal, not user input. |
| **3. Frontend `page.tsx` Size** | **FIXED** | Massive improvement. Reduced from ~1470 lines to ~516 lines. Logic extracted to hooks/components. |
| **4. Memory Leak in Query Cache** | **MITIGATED** | `maxKeys: 100` caps the memory usage. `useClones: false` remains a trade-off for performance. |
| **5. Hardcoded Timeouts** | **OPEN** | Timeouts (15s, 30s, 60s) remain scattered across `CardController.js`, `scraper.js`, and `search-index.js`. |
| **6. Error Handling Inconsistency** | **IMPROVED** | Consistent use of scoped `logger` utility across controllers and services. |
| **7. Unused Imports** | **IMPROVED** | Frontend cleanup likely resolved most of this during the `page.tsx` refactor. |
| **8. `eslint-disable` in `page.tsx`** | **OPEN** | `eslint-disable @typescript-eslint/no-explicit-any` still present at top of file. |
| **9. Levenshtein in Hot Path** | **OPEN** | Fuzzy matching logic remains unchanged in `database.js`. |

---

## New Findings & Observations

### 1. Search Service Complexity (`backend/services/search-index.js`)
**Severity:** Moderate (Maintainability)

The `search-index.js` file has grown to over 1200 lines. It currently handles:
*   Meilisearch configuration & client management.
*   Vector search logic (Ollama embeddings, RRF fusion).
*   Boolean expression parsing (Tokenizing, AST parsing, Transformation).
*   Index queue processing.
*   Search result construction.

**Recommendation:** Split this file into smaller, focused modules:
*   `services/search/MeiliService.js` (Client/Index mgmt)
*   `services/search/VectorService.js` (Embedding, RRF)
*   `utils/BooleanParser.js` (AST logic)

### 2. Successful API Client Refactor
**Severity:** Positive

The creation of `backend/services/ApiClient.js` to centralize Axios configuration, rate limiting, and blacklisting is a strong architectural improvement. It prevents code duplication between `scraper.js` and the new `LorebookService.js`.

### 3. Lorebook Integration
**Severity:** Positive

The new `LorebookService.js` correctly implements the download logic for linked lorebooks. It respects the existing project structure (static file storage) and integrates cleanly into the sync process via `scraper.js`.

### 4. Hardcoded Config in New Services
**Severity:** Minor

*   `ApiClient.js`: `timeout: 30000` is hardcoded.
*   `LorebookService.js`: Directory checking logic is sound, but error handling relies on generic log warnings.

---

## Updated Top Actions

1.  **Refactor `search-index.js`**: Break down the monolithic search service into specialized modules to improve maintainability and testing.
2.  **Centralize Configuration**: Move hardcoded timeouts (from `CardController`, `scraper`, `ApiClient`, `search-index`) into `config.js` or a constant definitions file.
3.  **Frontend Type Safety**: Address the `no-explicit-any` in `page.tsx` to ensure robust typing for the main UI.

---

## Summary

| Category | Rating | Trend |
|----------|--------| :---: |
| Architecture | ★★★★★ | ↗ |
| Code Quality | ★★★☆☆ | → |
| Security | ★★★★☆ | → |
| Performance | ★★★★☆ | → |
| Maintainability | ★★★☆☆ | ↗ |

The project is evolving well. The backend refactoring work has paid off, making feature additions like Lorebook support straightforward. The next major technical debt to address is the growing complexity of the search subsystem.