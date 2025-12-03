# Developer Instructions: Universal Lorebook Importer Strategy

## Objective
Create a robust `LorebookImporter` class/function that accepts a JSON object (representing a lorebook from any era) and normalizes it into the **SillyTavern V2++** format.

**Target Output Format (V2++):**
- **Structure:** `entries` should be normalized to an **Array** (preferred for iteration) or an **Object** with numeric keys (if strictly adhering to legacy ST). *Recommendation: Normalize to Array.*
- **Fields:** All logic fields (`probability`, `selectiveLogic`, `uid`) must exist at the **root** of the entry object.
- **No Encapsulation:** Do not hide data inside `extensions` unless it is truly obscure.

---

## 1. Detection Logic
Determine the format of the input JSON:

1.  **Check for V3:** Does `spec` == `"chara_card_v3"`?
    *   *Strategy:* Extraction & Flattening.
2.  **Check for Legacy/SillyTavern:** Is `entries` an **Object/Map** (not an Array)?
    *   *Strategy:* Conversion to Array.
3.  **Check for Standard V2:** Is `entries` an **Array** and `spec` != `"chara_card_v3"`?
    *   *Strategy:* Pass-through with default hydration.

---

## 2. Transformation Rules

### A. Handling V3 (The "Un-Encapsulator")
V3 stores engine-specific data in `extensions`. We must pull this back to the root to make it V2++ compatible.

*   **Step 1:** Iterate through `entries`.
*   **Step 2:** Check for `extensions.silly_tavern` (or similar keys like `extensions.chub`).
*   **Step 3 (Flattening):**
    *   If `entry.extensions.silly_tavern.selectiveLogic` exists -> move to `entry.selectiveLogic`.
    *   If `entry.extensions.silly_tavern.uid` exists -> move to `entry.uid`.
    *   *Repeat for:* `probability`, `scan_depth`, `token_budget`, `case_sensitive`, `automationId`.
*   **Step 4:** Preserve the original `extensions` object if it contains *other* data, but remove the extracted keys to avoid duplication.

### B. Handling Object-based Entries (Legacy ST)
SillyTavern often stores entries as `{"0": {...}, "1": {...}}`.

*   **Step 1:** Convert the Object values into an Array.
*   **Step 2:** Ensure `uid` integrity. If the object key was "5" but the internal `uid` was missing, assign `uid: 5`.
*   **Step 3:** Re-sort the array based on `insertion_order` (if present) or the numeric keys.

### C. Universal Field Hydration (Sanitization)
Ensure specific fields exist and have the correct types for the target V2++ format:

*   **`uid`**: Must be an Integer. Generate unique ID if missing.
*   **`key` / `keys`**:
    *   V2/ST often uses `key` (Array).
    *   V3 uses `keys` (Array).
    *   *Action:* Normalize to `key` (or `keys` depending on your specific backend model), ensuring it is always an Array of strings.
*   **`selectiveLogic`**: Ensure it is an Integer (0=AND, 1=OR, 2=NOT, etc.). Default to 0.
*   **`enabled`**: Boolean. Default to `true`.

---

## 3. Edge Case Handling

1.  **Missing "entries":** If the input has no `entries`, initialize an empty array.
2.  **"Recursive" vs "Scan Depth":**
    *   V3 might use `recursive_scanning` (bool).
    *   V2++ uses `scanDepth` (int) or `recursive` (bool).
    *   *Action:* Map `scan_depth` from extensions to root.
3.  **Conflicting IDs:** If merging multiple lorebooks, regenerate `uid`s to avoid collisions.

---

## 4. Validation Checklist
The output object must pass these checks:
- [ ] Root object has `entries` (Array).
- [ ] Every entry has a `uid` (Int).
- [ ] Every entry has `key` (Array of strings).
- [ ] Fancy logic (`probability`) is at the entry root, not deep in `extensions`.
