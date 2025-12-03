# Lorebook Structural Analysis Report: Comparison to CCV3 Specification

**Date:** 2025-12-03
**Scope:** Structural analysis of 1636 embedded lorebooks within the local archive.

---

## Objective
To perform a structural analysis of lorebook data within the `character_archive` to identify fields and compare them against the Character Card V3 (CCV3) specification's definition of a `Lorebook` object.

## Methodology
1.  Identified 5055 cards in `cards.db` marked with `hasEmbeddedLorebook = 1`.
2.  Extracted the `character_book` JSON object (representing the lorebook) from the `definition.data` field within the `static/XX/cardId.json` files for these cards. Successfully extracted 1636 such lorebook objects.
3.  Analyzed the structure of these 1636 extracted lorebook JSONs against the CCV3 `Lorebook` object specification, looking for required fields, type consistency, and unexpected fields.

## Key Findings

### 1. Lorebook Data Source
The project stores lorebook data embedded within `static/XX/cardId.json` files, specifically nested under `metadata.definition.data.character_book`. It does *not* typically store them as top-level `character_book` objects in these JSONs, nor consistently within `ccv3` `tEXt` chunks of PNGs for locally archived cards.
*   **Note:** Many cards marked `hasLorebook=1` in the database are found to have `related_lorebooks` (linked lorebooks) rather than an `embedded` `character_book` object in their JSON metadata.

### 2. Overall CCV3 Compliance (Lorebook Object)
The analyzed lorebook objects show **0% strict compliance** with the CCV3 specification when viewed purely as isolated `Lorebook` objects.

### 3. Specific Structural Discrepancies

*   **Missing `spec` and `spec_version`:** The extracted `character_book` objects (lorebooks) do not contain `spec` or `spec_version` fields. These fields are part of the overarching `CharacterCardV3` object, not the `Lorebook` object itself within the CCV3 spec. Our analysis script incorrectly expected these at the lorebook's root.

*   **Type Mismatches (Resolved):** Initial analysis flagged type mismatches for `id` (expected string, found integer) and `position` (expected integer, found string) within lorebook entries. These were reconciled in the analysis script to accept both types, indicating flexibility in existing implementations.

*   **Unexpected Top-Level Lorebook Keys (not strictly CCV3):** The following fields were found at the root of the `character_book` object for all 1636 analyzed lorebooks, which are not part of the core CCV3 `Lorebook` object specification:
    *   `scan_depth`
    *   `token_budget`
    *   `recursive_scanning`
    *   `extensions` (Although CCV3 allows `extensions`, it typically recommends custom data within it, not as a standalone top-level field for non-standard properties.)

*   **Unexpected Lorebook Entry Keys (not strictly CCV3):** The following fields were found within lorebook entries across all 1636 analyzed lorebooks, which are not part of the core CCV3 `Lorebook` Entry specification:
    *   `probability`
    *   `selectiveLogic`
    *   `extensions` (Similar to the top-level, the `extensions` field at the entry level is likely a container for custom data, making its presence compliant in principle, but its specific contents would need further deep-dive to compare with explicit CCV3 extensions.)

## Conclusion

The lorebook objects within this archive generally follow a structure consistent with **Character Card V2** formatting, where certain fields like `scan_depth`, `token_budget`, `recursive_scanning`, `probability`, and `selectiveLogic` are directly present at the lorebook or entry level. While CCV3 embraces flexibility through an `extensions` field, the direct inclusion of these non-standard fields at the top level of the `Lorebook` object deviates from a strict interpretation of the core CCV3 `Lorebook` structure.

This project's archival method, while effective for its own purposes, means that the raw JSON metadata for character cards (including lorebooks) is closer to the older V2 format or a hybrid interpretation, rather than a pure, isolated CCV3 `Lorebook` object.
