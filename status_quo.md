# KarnForge — Status Quo

> One-read reference for the entire project: what it is, how it's built, what each piece does.

---

## What It Is

**KarnForge** is a cross-platform Electron desktop app for Magic: The Gathering deck building and collection management. It integrates with Claude AI (via the `claude` CLI) for AI-assisted deck building, and with a companion binary called **karn-arsenal** that provides the card database and additional MCP servers.

**App ID:** `com.karnforge.app`  
**Data root:** `~/karnData/` (Windows) or `~/.karnData/` (others)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 33 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v3 |
| State | Zustand 5 |
| Database | better-sqlite3 12 (two SQLite DBs) |
| AI | Claude CLI subprocess + MCP protocol |
| Build | electron-builder (NSIS / DMG / AppImage) |

---

## Repository Layout

```
karnforge/
├── main.js                   # Electron main process entry
├── preload.js                # contextBridge API surface
├── settings.js               # settings.json read/write + safeStorage encryption
├── ipc/
│   ├── library.js            # 44 lib:* IPC handlers
│   ├── cards.js              # 12 cards:* handlers + external API fetches
│   ├── ai.js                 # ai:* handlers — Claude CLI subprocess management
│   └── arsenal.js            # arsenal:* handlers — ArsenalManager class
├── db/
│   ├── library.js            # library.db schema, all CRUD, migrations
│   └── cards.js              # prints.db access + ai_card_metadata table
├── utils/
│   ├── paths.js              # resolveKarnDataDir / resolveUserDir / resolveArsenalDir
│   ├── logger.js             # rotating file logger + ANSI console
│   └── claude-mcp.js         # writes .claude/settings.json for MCP server registration
├── mcp/
│   ├── index.js              # subprocess entry (ELECTRON_RUN_AS_NODE=1)
│   └── server.ts             # McpServer with 31 tools + 5 resources
├── resources/
│   └── arsenal/              # bundled karn-arsenal binaries (copied via extraResources)
└── src/renderer/
    ├── App.tsx               # HashRouter + route config + widget bootstrap
    ├── types/electron.d.ts   # all TypeScript interfaces + Window declaration
    ├── pages/
    │   ├── Dashboard.tsx
    │   ├── DeckView.tsx      # ~4750 lines — the canvas engine
    │   ├── AllDecks.tsx
    │   ├── Collection.tsx
    │   ├── Wishlist.tsx
    │   ├── Recents.tsx
    │   ├── Settings.tsx
    │   ├── Widgets.tsx
    │   └── Favorites.tsx
    ├── components/           # UI components (see below)
    ├── store/                # Zustand stores (see below)
    ├── widgets/              # widget + decorator registry + builtins
    └── utils/
        ├── escape.ts         # esc() — HTML-escape for template string injection
        └── logger.ts         # createLogger(module) — renderer-side console logger
```

---

## Startup Sequence (`main.js`)

1. `resolveUserDir()` — ensures `karnData/user/` exists
2. `initLogger(userDir)` — opens rotating log file (5 MB cap)
3. `initLibrary(userDir)` — opens/migrates `library.db`
4. `new ArsenalManager()` — discovers arsenal executables, sets up GitHub update checker
5. `initCards(arsenal.dataDir)` — opens `prints.db` (nullable if arsenal not installed)
6. Registers all IPC handlers (library, cards, AI, settings, shell, arsenal)
7. `writeClaudeMcpSettings(arsenal)` — writes `.claude/settings.json`

**BrowserWindow:** `1280×820`, min `960×640`, `frame:false`, `backgroundColor:#0D0D0D`, full context isolation.

---

## Data Storage

### `library.db` — owns everything user-created

| Table | What it stores |
|---|---|
| `folders` | Nested folder hierarchy (parent_id, CASCADE DELETE) |
| `decks` | Deck metadata: name, format, description, cover image, color identity, power level, favorite, sort order, recipient assignment |
| `deck_cards` | Cards in a deck: oracle_id, scryfall_id, quantity, board (main/sideboard/commanders/maybeboard), category, sort_order, is_proxy |
| `collection` | Physical card collection: quantity, foil, condition, language, acquired price, recipient assignment |
| `wishlist` | Wanted cards with priority (0=Low → 3=Critical) and notes |
| `activity_log` | Event log (card_added, etc.) keyed to deck + oracle_id |
| `arrangements` | Named canvas layouts per deck (canvas_json stored as JSON) |
| `canvas_states` | Legacy single canvas per deck (superseded by arrangements) |
| `recipients` | Physical storage locations: binder/box/deck_box/other |
| `ai_conversations` | AI chat sessions per deck, with declined_oracle_ids |
| `ai_messages` | Individual messages: role (user/assistant/tool), content, ui_blocks |
| `agent_memory` | Key-value store for AI agent persistent memory |

WAL mode + `PRAGMA foreign_keys = ON`. Migrations are additive (try/catch ALTER TABLE).

### `prints.db` — owned by karn-arsenal, read-only for KarnForge

Card database (~30k cards). KarnForge creates one additional table on top:

**`ai_card_metadata`** — per-card AI enrichment: `archetype_tags`, `synergy_pairs`, `role_tags`, `edhrec_inclusion_pct`, timestamps.

---

## IPC Architecture

All renderer↔main communication goes through `contextBridge`. Request/response uses `ipcRenderer.invoke` / `ipcMain.handle`. Push events (streaming) use `ipcMain → webContents.send` + `ipcRenderer.on`.

### Window Control
`minimizeWindow`, `maximizeWindow`, `closeWindow` — fire-and-forget via `ipcMain.on`.

### Library (`lib:*`) — 44 channels

| Group | Channels |
|---|---|
| Folders | `getFolderTree`, `createFolder`, `renameFolder`, `deleteFolder`, `moveFolder` |
| Decks | `getDecks`, `createDeck`, `getDeck`, `updateDeck`, `deleteDeck`, `moveDeck`, `duplicateDeck` |
| Deck cards | `addCardToDeck`, `removeCardFromDeck`, `updateCardBoard`, `updateCardQuantity`, `updateCardProxy` |
| Recipients | `getRecipients`, `createRecipient`, `updateRecipient`, `deleteRecipient` |
| Deck mounting | `mountDeck`, `unmountDeck` |
| Collection | `getCollection`, `addToCollection`, `removeFromCollection`, `updateCollectionEntry` |
| Wishlist | `getWishlist`, `addToWishlist`, `removeFromWishlist`, `updateWishlistEntry` |
| Card statuses | `getDeckCardStatuses` — per-card status map (in-recipient / in-recipient-diff / proxy / in-collection / missing) |
| Analytics | `logActivity`, `getActivityLog`, `getDecksWithCard`, `getMostUsedCards` |
| Canvas | `saveCanvas`, `loadCanvas` (legacy), `getArrangements`, `createArrangement`, `renameArrangement`, `deleteArrangement`, `saveArrangementCanvas`, `loadArrangementCanvas` |

### Cards (`cards:*`) — 12 channels

Queries `prints.db`. Card search supports 16 filter types: FTS5 text, colors, types, CMC, rarity, set, legality, gameChanger, power/toughness, price, keywords, loyalty, colorCount, layout, reserved list, edhrecRank, producedMana.

Also: `fetchEdhrecData` (24h in-memory cache), `fetchEdhrecCommander`, `fetchEdhrecTheme`, `fetchSpellbookCombos` (6h cache) — all fetch from external APIs in the main process.

### AI (`ai:*`)

Spawns the `claude` CLI binary as a child process:

| Channel | What happens |
|---|---|
| `ai:checkClaude` | `claude --version` + checks credentials (OAuth / ANTHROPIC_API_KEY) |
| `ai:chat` | Spawns `claude -p <text> --output-format stream-json --verbose [--resume <sessionId>]`, streams `ai:token` events, fires `ai:done` with sessionId |
| `ai:abort` | Kills the chat subprocess |
| `ai:clearSession` | Resets sessionId to null |
| `ai:getMemory`, `upsertMemory`, `deleteMemory` | CRUD on `agent_memory` table |
| `ai:cardQuery` | Separate Claude subprocess with MCP `search_cards` tool; streams `ai:cardQueryToken`; extracts `<cards>[oracle_ids]</cards>` tag and fires `ai:cardQueryResult` |
| `ai:cardQueryAbort` | Kills the card query subprocess |

Push events: `ai:token`, `ai:done`, `ai:error`, `ai:cardQueryToken`, `ai:cardQueryResult`, `ai:cardQueryDone`, `ai:cardQueryError`.

### Arsenal (`arsenal:*`)

Manages the karn-arsenal companion binary. Checks GitHub releases for updates (1h cache). Downloads zip, extracts via PowerShell/unzip, writes `version.txt`. Push event: `arsenal:progress` (0–100).

### Settings (`settings:*`)

Reads/writes `settings.json`. `ai.apiKey` is encrypted at rest via Electron `safeStorage`. `shell:openUserData` / `shell:openLogs` open folders in the OS file manager.

---

## MCP Server (`mcp/server.ts`)

Runs as a separate Node process (stdio transport). Claude Code spawns it on-demand. Registered as `karnforge` in `.claude/settings.json` alongside karn-arsenal's own MCP servers (`karn-cards`, `karn-rules`).

**31 tools across 6 categories:**

| Category | Tools |
|---|---|
| Card DB | `search_cards`, `get_card`, `get_cards_by_names`, `get_card_images`, `search_by_role` |
| External APIs | `fetch_edhrec_data`, `fetch_edhrec_commander`, `fetch_spellbook_combos` |
| Folders | `get_folder_tree`, `create_folder` |
| Decks | `list_decks`, `get_deck`, `create_deck`, `update_deck`, `delete_deck`, `duplicate_deck` |
| Deck cards | `add_card_to_deck`, `remove_card_from_deck`, `update_card_quantity`, `update_card_board`, `get_deck_card_statuses` |
| Collection | `get_collection`, `add_to_collection`, `remove_from_collection` |
| Wishlist | `get_wishlist`, `add_to_wishlist`, `remove_from_wishlist` |
| Analytics | `get_most_used_cards`, `get_decks_with_card`, `get_activity_log` |

**5 readable resources:** `karnforge://decks`, `karnforge://collection`, `karnforge://wishlist`, `karnforge://folders`, `karnforge://deck/{id}`

---

## Routing

`HashRouter` — all routes:

| Route | Component | Notes |
|---|---|---|
| `/deck/:id` | `DeckView` | Standalone, no AppLayout |
| `/` | `Dashboard` | Index |
| `/decks` | `AllDecks` | |
| `/collection` | `Collection` | |
| `/wishlist` | `Wishlist` | |
| `/recents` | `Recents` | |
| `/settings` | `Settings` | |
| `/widgets` | `Widgets` | |

`<GlobalCardTooltip />` and `<AIChatPanel />` are always mounted outside the route tree.

---

## State Management (Zustand Stores)

### `useLibraryStore`
Holds `folders[]`, `decks[]`, `recipients[]`, `isLoaded`, `isLoading`.

- `loadLibrary()` — guarded double-load; parallel fetch of getFolderTree + getDecks + getRecipients
- `createDeck()` — IPC + optimistic append (no reload)
- `deleteFolder()` — reloads both folders AND decks (cascade nulls `deck.folder_id`)
- `updateDeckCardCount(deckId, delta)` — in-place update, no IPC
- `mountDeck/unmountDeck` — updates `recipient_id/name/type` in-place

### `useAIStore`
Holds `isOpen`, `messages (ChatMessage[])`, `isStreaming`, `streamingText`.

- `sendMessage(text)` — registers `onToken/onDone/onError`, accumulates `streamingText`, converts to message on done
- `abort()` — kills subprocess, appends partial message with "*(aborted)*"
- `clearHistory()` — calls `aiAPI.clearSession()`, clears messages

### `useToastStore`
Types: `success` (4s), `info` (5s), `warning` (6s), `error` (sticky), `progress` (sticky).
- `push({ type, title, message, id?, progress?, icon?, spinIcon?, dismissible? })`
- `update(id, patch)` — in-place update used by progress toasts

### `useConfirmStore`
Single modal driven by `show(opts)`. `opts` includes title, message, labels, danger flag, size (sm/md/lg), onConfirm, onCancel.

### `useSearchStore`
Simple `value/placeholder` — pages set placeholder on mount, reset on unmount.

### `useGlobalSearchStore`
`isOpen` toggle. Opened by `Ctrl+K`.

---

## Pages

### Dashboard
- `ActivityChart` — daily activity bar chart
- `ColorDonut` — SVG donut of color distribution across all decks
- `PowerGauge` — arc gauge of average power level
- Recent decks grid (max 8 unless filtered) via `useFilteredDecks`
- Format breakdown bar chart
- Most-used cards: `getMostUsedCards({limit:10})` → batch art_crop fetch

### DeckView (`~4750 lines`)

Full-screen standalone page with its own Sidebar, ToastStack, ConfirmDialog.

#### Canvas System
Imperative DOM — pan/zoom/item positions are stored in refs and written directly to DOM (not React state) for performance.

| Element | DOM class | Description |
|---|---|---|
| Cards | `.card-stack` | Art crop image, qty badge, board badge, decorator overlays |
| Groups | `.group-container` | Collapsible containers; drag-to-add cards; layout modes: grid / stack-h / stack-v |
| Stickers | `.sticker` | Textarea with Markdown view/edit toggle (via `marked`) |
| Widgets | `.canvas-widget` | HTML rendered by `new Function()` eval, scalable with zoom, per-instance params |
| Decorators | `.canvas-decorator` | Pill overlays anchored to individual cards (tl/tr/bl/br/bc/tc) |

**Transform state:** `tx`, `ty`, `sc` (scale) stored in refs, applied as CSS transform to the canvas layer. Zoom range: 10%–400%.

**Interactions:**
- Pan: drag on viewport background
- Zoom: `Ctrl+Wheel`
- Rubber-band selection: rAF-throttled mousemove rect
- Card drag: 120ms delay + 5px threshold, ghost element
- Multi-select drag: initial position map

**Keyboard shortcuts:**

| Key | Action |
|---|---|
| `H` | Hand (pan) mode |
| `V` | Select mode |
| `N` | Add sticker |
| `G` | Group modal |
| `W` | Widget picker |
| `K` | Card search panel |
| `Ctrl+A` | Select all |
| `Delete/Backspace` | Remove selected from deck |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo (max 50 entries / 2 MB) |

**Serialization:** `serializeCanvas()` captures all groups/freeCards/stickers/widgets/decorators with positions. `restoreCanvas()` rebuilds from JSON. Auto-save: 1500ms debounce to `saveArrangementCanvas`.

**Arrangements:** Named canvas layouts per deck. `switchArrangement()` saves current then loads new. `reconcileCanvas()` ensures all deck cards appear on canvas after load or card add/remove. `createArrangement` starts a fresh canvas.

**Auto-layout:** `handleAutoLayout()` grids free cards 5-per-row. `handleAutoArrange()` creates typed groups (Commanders/Creatures/Instants/…) and drops free cards into them.

#### Tabs in DeckView

| Tab | Description |
|---|---|
| Canvas | The main drag-and-drop canvas |
| List | Sortable card table by board/type/name/CMC |
| Missing | Cards in the deck not present in collection |
| Simulate | Hypergeometric draw probability simulator |
| Combos | Commander Spellbook integration — shows combos with cards/results/description |

#### Card Statuses (from `getDeckCardStatuses`)

| Status | Meaning |
|---|---|
| `in-recipient` | In collection, assigned to same recipient as the deck |
| `in-recipient-diff` | In collection, but in a different recipient |
| `proxy` | Marked as proxy |
| `in-collection` | In collection but not assigned to a recipient |
| `missing` | Not in collection at all |

#### AI Integration in DeckView
DeckView listens to custom DOM events fired by `AIChatPanel`:

| Event | Effect |
|---|---|
| `ai:create-group` | Creates a canvas group from a list of oracle_ids |
| `ai:set-search-filters` | Opens search panel with pre-filled filters |
| `ai:add-sticker` | Places a sticker at canvas center |
| `ai:apply-swap` | Removes one card, adds another |
| `ai:remove-cards` | Removes multiple cards by oracle_id |

#### Import/Export
- **Export:** Formats deck as grouped text (`// Commander`, `// Creatures`, etc.), copies to clipboard
- **Import:** Parses `N Card Name` lines, batch-resolves via `getCardsByNames`, spawns each card onto canvas

### Collection
- Sortable table (name / condition / qty / foil / price)
- Inline edit row; per-entry recipient assignment
- Stats: totalQty, portfolioValue, condition breakdown
- Bulk import modal (parses `4 Lightning Bolt` lines, resolves cards)
- CSV export

### Wishlist
- Drag-to-reorder rows (HTML5 drag, persisted order in `localStorage`)
- Per-entry debounced update (300ms)
- Priority levels: Low / Normal / High / Critical
- Market value: sum(qty × price)
- "Owned" badge when card is in collection
- `AddToDeckPopover` — inline dropdown to add card to any deck

### AllDecks / Favorites / Recents
All use `useFilteredDecks` hook (search + format filter + sort). Favorites filters `is_favorite`. Recents shows last 12 by `updated_at`.

### Settings
- Default format selector
- Card database status (cardCount + last_updated_at from karn-arsenal)
- `ArsenalPanel` — MCP server status, update check, download progress, restart
- Open Data Folder / Open Logs Folder

### Widgets
Gallery of built-in + custom widgets. Live preview with mock data (100-card Atraxa Superfriends). Edit/delete custom widgets via `WidgetEditorModal`. Calls `persistCustomWidgets()` on save/delete.

---

## Widget System

### Architecture

**`WidgetRegistryClass`** (`registry.ts`) — singleton registry for canvas widgets.

Each `WidgetDef` contains:
- `id`, `name`, `description`, `icon`, `readonly` (builtins are readonly)
- `width` — pixel width on canvas
- `params[]` — user-configurable parameters (number/boolean/text/select)
- `code` — JS body returning an HTML string; executed via `new Function('data','params','asyncData', code)`
- `asyncWidgetData?` — async fn to fetch external data (EDHREC API, etc.)
- `decorator?` — card overlay definition embedded in the widget

**`CardDecoratorRegistryClass`** (`overlayRegistry.ts`) — singleton registry for card overlays.

Each `CardDecoratorDef` contains:
- `id`, `name`, `description`, `icon`, `readonly`
- `anchor` — position on card: `tl/tr/bl/br/bc/tc`
- `code` — JS body returning an HTML string; receives `OverlayCardData`
- `params[]`, `asyncLoad?`

`OverlayCardData` passed to decorator: `oracleId`, `name`, `typeLine`, `manaCost`, `cmc`, `colorIdentity`, `edhrecRank?`, `edhrecPct?`, `collectionStatus?`.

### Built-in Widgets (10)

| Widget | Width | What it shows |
|---|---|---|
| `color-distribution` | 210px | W/U/B/R/G/C pip count bars |
| `mana-curve` | 210px | CMC histogram; configurable cap (4–10); excludes lands toggle |
| `draw-odds` | 255px | Hypergeometric P(draw ≥1) for opening hand + turn 5 |
| `type-breakdown` | 210px | Bar chart per card type |
| `deck-stats` | 185px | Total / creatures / lands / non-lands / avg CMC |
| `land-ratio` | 220px | SVG donut + count vs target%, diff badge |
| `edhrec` | 235px | % inclusion tier distribution; `bc-anchor` decorator showing EDHREC % or rank badge; asyncLoad fetches % per card from EDHREC API |
| `collection-status` | 230px | in-recipient / in-recipient-diff / proxy / in-collection / missing counts; `bl-anchor` colored dot decorator per card |
| `deck-roles` | 255px | Ramp/draw/removal/board_wipe/tutor/counterspell/graveyard/token/win_condition counts vs ideal EDH ratios; asyncWidgetData calls `getRoleTags` |
| `edhrec-commander` | 265px | Commander-page recommendations with % bar + synergy; asyncWidgetData calls `fetchEdhrecCommander` |

Custom widgets can be created and persisted; stored in settings, loaded into registry on startup.

---

## Key Components

### `Sidebar`
Fixed 280px left panel. Logo → Dashboard → Library section with `FolderTree` → Browse (Recents/Collection/Wishlist) → Customization (Widgets/Settings). Has `TrafficLights` (custom window controls, macOS style). Buttons for new deck/folder. AI panel toggle + global search trigger.

### `FolderTree`
Full folder+deck tree with:
- `InlineRename` — click-to-rename with Enter/Escape
- `DeckItem` — NavLink to `/deck/:id`, context menu (Open/Rename/Duplicate/Move/Delete), draggable
- `FolderItem` — collapsible, context menu (New Subfolder/New Deck/Rename/Delete), drop target
- DnD: `folderContains()` prevents circular drops; `canAcceptDrop` computed per node
- `MoveDeckModal` — separate modal for moving a deck

### `GlobalSearch` (Ctrl+K)
Full-screen overlay (portal to `document.body`). Grouped results: Pages / Decks (up to 8) / Folders (up to 5) / Cards (up to 5, async 250ms debounce). Keyboard navigation (↑/↓/Enter/Esc). Highlights matched text. Card results navigate to `/collection` and pre-fill `useSearchStore`.

### `GlobalCardTooltip`
Global `mouseover` listener on `document`. Triggers on any element with `data-oracle-id`. Shows 210px card image at cursor. 350ms delay before fetch (instant if cached). In-memory cache: `Map<oracleId, imageUrl>`. 120ms hide delay for cursor movement.

### `AIChatPanel`
Fixed 480px right panel (`z-index: 300`). Checks Claude setup on open. Shows setup banner (checking / not_installed / not_logged_in / ready). Streaming message display. Clear history + close. Fires custom DOM events to DeckView (see AI Integration above).

### `CardSearchPanel`
Full-featured search form exposed via `forwardRef/useImperativeHandle` for external filter injection:
- Free-text query (name / oracle text / both)
- Color chips (W/U/B/R/G/C)
- Type chips (Creature/Instant/Sorcery/Enchantment/Artifact/Planeswalker/Land)
- Rarity chips (C/U/R/M)
- Format chips (Std/Pio/Mod/Leg/Vin/EDH/Ppr/Exp)
- 20 keyword chips
- Layout filter (Normal/Transform/Modal DFC/Adventure/Saga/Class/Split)
- CMC range, power/toughness range, price max, color count

### `ArsenalPanel`
Settings-page component. Polls `arsenal:getStatus` every 5s. Shows Rules MCP / Cards MCP install status. Update check → download progress bar → install. Restart Servers button.

### `WidgetEditorModal`
Tabbed form for creating/editing widgets and card decorators. Live preview with sample data. Name, icon picker (27 icons), width/anchor, params list (key/label/type/default). Code textarea with `new Function()` eval preview. Default templates provided.

### Charts
- `ActivityChart` — daily activity bar chart (last N days)
- `ColorDonut` — SVG donut of color distribution
- `PowerGauge` — arc gauge showing average power level

### Utility Components
- `ContextMenu` — positioned portal dropdown; `MenuItem` = `{ label, icon?, danger?, onClick?, divider? }`
- `ConfirmDialog` — modal driven by `useConfirmStore`; danger mode = red confirm button
- `ToastStack` — toasts stacked at bottom-right
- `ManaSymbol` — renders MTG mana symbols using mana-font
- `TrafficLights` — custom minimize/maximize/close buttons
- `PageHeader` — standardized page title with icon

---

## `useFilteredDecks` Hook

Single source of truth for deck filtering used by Dashboard, AllDecks, Favorites, Recents:
- Filters: `search` (name substring), `formatFilter`, `favoritesOnly`
- Sort keys: `updated` (default), `name`, `cards` (card_count), `created`
- `limit` applied only when no active filter

---

## Key Data Flows

### Opening a Deck
1. Navigate to `/deck/:id` → `DeckView` mounts
2. `getDeck(id)` → deck + cards; `getCardsBatch(oracleIds)` → card details
3. `getArrangements(deckId)` → load last arrangement or create default
4. `loadArrangementCanvas(id)` → `restoreCanvas(json)` builds DOM elements
5. `reconcileCanvas()` ensures all deck cards appear on canvas
6. `getDeckCardStatuses(deckId)` → populates `cardStatuses` map
7. Widget and decorator overlays applied to all cards

### Adding a Card
1. `CardSearchPanel` result clicked → `handleAddCard(card)`
2. Commander singleton check (if format = commander)
3. `libraryAPI.addCardToDeck` → returns `{ id }` (deck_cards row)
4. `logActivity` for the add event
5. Optimistic state update in DeckView
6. `updateDeckCardCount(deckId, 1)` in library store (no reload)
7. `spawnCardOnCanvas(card, 1, 'main', entryId)` — creates `.card-stack` DOM element
8. Auto-save triggered (1500ms debounce)

### AI Chat Message
1. User types in `ChatInput` → `useAIStore.sendMessage(text)`
2. `aiAPI.chat(text)` → `ai:chat` IPC
3. Main spawns `claude -p <text> --output-format stream-json --verbose [--resume <sessionId>]`
4. Each assistant delta → `ai:token` event → `streamingText` accumulated
5. Final result event → `ai:done` with sessionId
6. `streamingText` converted to assistant `ChatMessage`

### AI Card Query (DeckView AI search)
1. User query → `aiAPI.cardQuery(prompt)`
2. Separate Claude subprocess instructed to use `search_cards` MCP tool, wrap results in `<cards>` tag
3. Streams `ai:cardQueryToken` for visible text (tag stripped)
4. On `<cards>[...]</cards>` detection → `ai:cardQueryResult` with oracle_ids
5. DeckView listener fires `ai:create-group` custom DOM event → groups those cards on canvas

### Arsenal Update
1. `arsenal:checkForUpdates` → GitHub releases API (1h cache)
2. `arsenal:downloadUpdate` → download zip, extract via PowerShell/unzip, write `version.txt`
3. `arsenal:progress` push events (0–100) → progress toast in UI
4. `arsenal:restart` → returns updated status

---

## Build & Configuration

### `vite.config.ts`
- Root: `src/renderer/`, output: `dist/renderer/`
- Dev server: `localhost:5173` (strictPort)
- Plugin: `@vitejs/plugin-react`

### `tsconfig.json`
- Target: ES2022, module: ESNext, moduleResolution: bundler
- `jsx: react-jsx`, `strict: true`, `noEmit: true`
- Includes `src/**/*`

### `electron-builder`
- `extraResources`: copies `resources/arsenal/` → installed package
- Platforms: NSIS (Windows), DMG (macOS), AppImage (Linux)
- `postinstall`: runs `electron-rebuild` for `better-sqlite3`

### Logger (`utils/logger.js`)
- `initLogger(userDir)` — opens `user/logs/karnforge.log`, rotates at 5 MB
- `createModuleLogger(module)` — `{ debug, info, warn, error }` with ANSI console + file output
- Level: `LOG_LEVEL` env var → `INFO` (prod) / `DEBUG` (dev)

---

## Design Decisions & Approaches

| Decision | Rationale |
|---|---|
| Imperative DOM for canvas | React re-renders at 60fps would be too slow for pan/zoom with 100+ card elements |
| Two SQLite databases | `library.db` is user-owned; `prints.db` is karn-arsenal's domain — clean separation |
| Claude CLI subprocess for AI | No Anthropic SDK dependency; reuses the user's existing Claude Code auth (OAuth or API key) |
| MCP server as separate process | Claude Code spawns it via stdio; Electron runs it with `ELECTRON_RUN_AS_NODE=1` |
| `new Function()` for widgets | Allows user-written widget/decorator code to run safely in the renderer without bundling |
| Custom DOM events for AI↔DeckView | Avoids prop-drilling or store coupling between the always-mounted AI panel and route-specific DeckView |
| Optimistic updates for card add | Avoids a full deck reload on every card add; `updateDeckCardCount` patches in-place |
| Zustand 5 | Lightweight, no boilerplate, works well with React 19 |
| `safeStorage` for API key | Electron's OS keychain integration — key is never stored in plaintext |
