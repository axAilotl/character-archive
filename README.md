# Character Archive

**A locally-hosted, offline-first archive and search engine for AI character cards.**

This project allows you to mirror character cards from [Chub.ai](https://chub.ai) and [Character Tavern](https://character-tavern.com) to your local machine. It provides a fast, rich interface for browsing, searching (including semantic vector search), and managing your collection, completely independent of external servers once downloaded.

## 🚀 Key Features

*   **Dual Archiving:** Syncs from both Chub.ai (via API) and Character Tavern (via Meilisearch).
*   **Offline-First:** Downloads character cards (PNGs + JSON) and caches all gallery images/external assets locally.
*   **Advanced Search:**
    *   **SQL Search:** Fast filtering by tags, author, tokens, dates, and flags.
    *   **Semantic Vector Search:** (Optional) Use Ollama + Meilisearch to find characters by "vibe" or description, even if keywords don't match. Supports searching specific chunks of character definitions.
    *   **Boolean Logic:** Full support for `AND`, `OR`, `NOT`, and parenthetical grouping in search queries.
*   **Integrations:**
    *   **SillyTavern:** One-click push to a running SillyTavern instance. Tracks which cards are already loaded.
    *   **Character Architect:** Push cards directly to Character Architect for editing.
*   **Rich Metadata:** Extracts and indexes everything—alternate greetings, lorebooks, system prompts, and token counts per section.
*   **Asset Caching:** Automatically scrapes and downloads all images referenced in card descriptions and galleries so your archive never "rots."

---

## 🛠️ Requirements

*   **Node.js:** Version 20 or higher.
*   **SQLite:** (Bundled with Node.js drivers, no separate install usually needed).
*   **Meilisearch (Optional):** Version 1.5+ (Required for advanced/vector search and Character Tavern sync).
*   **Ollama (Optional):** Required only for semantic vector search embedding generation.

---

## 📦 Installation & Setup

### 1. Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/axAilotl/character-archive.git
cd character-archive
npm install
```

### 2. Configuration
The application relies on a `config.json` file. You can bootstrap this by copying the example helper script, but ultimately you will edit `config.json`.

1.  **Create the config loader:**
    ```bash
    cp config.js.example config.js
    ```
    *Note: `config.js` is the logic that loads/saves `config.json`. You usually don't edit `config.js` itself.*

2.  **Run the app once to generate `config.json`:**
    ```bash
    npm run start
    ```
    (Then Ctrl+C to stop it). This will create a default `config.json` in the root directory.

3.  **Edit `config.json`:**
    Open `config.json` and configure your settings. Key fields:

    *   **Chub API:**
        ```json
        "apikey": "YOUR_CHUB_API_KEY", 
        "chubProfileName": "your_username",
        "syncFollowedCreators": true
        ```
        *(API Key is required for Timeline sync. Search sync works without it but is rate-limited/censored.)*

    *   **Character Tavern (CT) Sync:**
        ```json
        "ctSync": {
            "enabled": true,
            "bearerToken": "YOUR_CT_BEARER_TOKEN", 
            "cfClearance": "YOUR_CLOUDFLARE_COOKIE",
            "session": "YOUR_CT_SESSION_COOKIE"
        }
        ```
        *(Bearer token and cookies are required due to CT's protections. Extract these from your browser dev tools network tab.)*

    *   **SillyTavern Integration:**
        ```json
        "sillyTavern": {
            "enabled": true,
            "baseUrl": "http://127.0.0.1:8000"
        }
        ```

    *   **Vector Search:**
        ```json
        "vectorSearch": {
            "enabled": true,
            "ollamaUrl": "http://127.0.0.1:11434",
            "embedModel": "snowflake-arctic-embed2:latest"
        }
        ```

### 3. Running the Application

**Development Mode (Recommended):**
Starts both the Backend API (port 6969) and Frontend UI (port 3177) with hot-reloading.
```bash
npm run dev
```
*   **Frontend:** [http://localhost:3177](http://localhost:3177)
*   **Backend:** [http://localhost:6969](http://localhost:6969)

**Production Mode:**
Build the frontend and run the optimized server.
```bash
npm run build --prefix frontend
npm run prod
```

---

## 📚 Usage Guide

### Syncing Cards

*   **Manual Sync (Chub):**
    Click the **Sync** button in the UI header, or run:
    ```bash
    npm run sync
    ```
    *This respects your `config.json` settings (timeline vs search, tags, etc).*

*   **Manual Sync (Character Tavern):**
    Click the **Sync CT** button (globe icon) in the UI, or run:
    ```bash
    npm run import:ct
    ```
    *(Note: CT sync requires valid cookies in config).*

### Searching

*   **Basic Search:** Type in the top bar. Searches name, description, author, and tags.
*   **Tag Search:** Use the "Include tags" / "Exclude tags" dropdowns.
*   **Advanced Flags:** Expand the "Advanced Flags" section to filter by specific features:
    *   *Has Lorebook / Embedded Lorebook*
    *   *Has Alternate Greetings*
    *   *Has Gallery* (locally cached)
    *   *Embedded Images* (images inside description/greetings)
*   **Vector Search:** If enabled, typing in the search bar automatically performs a hybrid semantic search. It finds cards that *mean* what you typed, not just text matches.

### Integration with SillyTavern

1.  Enable SillyTavern in `config.json` (`enabled: true`, correct `baseUrl`).
2.  In the Card Grid or Details Modal, click the **"Push to Silly Tavern"** button (paper plane icon).
3.  The card is uploaded to your ST instance.
4.  If successful, the card is automatically locally cached (assets downloaded) and marked as "Loaded in ST".

### Asset Caching

To ensure your archive is truly offline:
*   **Automatic:** Assets are cached automatically when you **Favorite** a card or **Push** it to SillyTavern.
*   **What gets cached?**
    *   Card PNG and metadata JSON.
    *   Gallery images (from Chub).
    *   External images linked in the description or markdown.
*   **Storage:** All assets are stored in `static/cached-assets/`.

---

## 🔧 Advanced Configuration

### Vector Search Setup (Optional)
1.  Install **Meilisearch** and **Ollama**.
2.  Pull an embedding model in Ollama:
    ```bash
    ollama pull snowflake-arctic-embed2
    ```
3.  Enable `vectorSearch` in `config.json` and restart the server.
4.  **Important:** You must populate the embeddings index:
    ```bash
    npm run vector:flush
    npm run vector:backfill
    ```
    *This process reads all your cards, generates embeddings via Ollama, and uploads them to Meilisearch. It may take a long time.*

### Maintenance Scripts
*   `npm run update-metadata`: Refreshes metadata for all local cards from their JSON files.
*   `npm run fix:flags`: Scans all cards and updates database feature flags (like `hasEmbeddedImages`).
*   `npm run sync:search`: Pushes all local database content to Meilisearch (for lexical search).

---

## ⚠️ Troubleshooting

*   **Sync Fails (Database not initialized):**
    Ensure you are running `npm run sync` from the project root. If using the script directly, ensure the database is initialized.
*   **404 on Refresh:**
    Refreshing Character Tavern cards is not supported individually (only bulk sync). The UI will now warn you instead of crashing.
*   **Meilisearch Errors:**
    If searches fail, ensure Meilisearch is running. If you recently changed schema, run `npm run sync:search`.
*   **"Missing Config":**
    If the app crashes complaining about config, ensure `config.json` exists and contains valid JSON. Validate your API keys.

---

## 📂 Data Location
*   **Database:** `cards.db` (SQLite) - Keep this safe!
*   **Images/Metadata:** `static/` - Contains all your downloaded card PNGs and JSONs.
*   **Asset Cache:** `static/cached-assets/` - Cached galleries and external images.
*   **Config:** `config.json` - Your local settings and secrets.

**Note:** All user data is git-ignored. You can safely pull updates to the code without overwriting your library.