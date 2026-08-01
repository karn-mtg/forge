'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'folder',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  format TEXT DEFAULT 'commander',
  description TEXT,
  cover_scryfall_id TEXT,
  color_identity TEXT,
  power_level INTEGER DEFAULT 5,
  is_favorite INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS deck_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  oracle_id TEXT NOT NULL,
  scryfall_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  board TEXT NOT NULL DEFAULT 'main',
  category TEXT,
  sort_order INTEGER DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oracle_id TEXT NOT NULL,
  scryfall_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  foil INTEGER NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT 'NM',
  language TEXT NOT NULL DEFAULT 'en',
  acquired_price_usd REAL,
  acquired_at TEXT,
  notes TEXT,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oracle_id TEXT NOT NULL,
  scryfall_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  deck_id INTEGER,
  oracle_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS canvas_states (
  deck_id INTEGER PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS arrangements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  canvas_json TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Fix #6: indexes missing from original schema
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id          ON deck_cards (deck_id);
CREATE INDEX IF NOT EXISTS idx_arrangements_deck_id        ON arrangements (deck_id);
CREATE INDEX IF NOT EXISTS idx_collection_oracle_id        ON collection (oracle_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_oracle_id          ON wishlist (oracle_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_deck_id        ON activity_log (deck_id);
CREATE INDEX IF NOT EXISTS idx_collection_added_at         ON collection (added_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishlist_sort               ON wishlist (priority DESC, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created_at         ON activity_log (created_at);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id    INTEGER REFERENCES decks(id) ON DELETE SET NULL,
  title      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content         TEXT NOT NULL,
  ui_blocks       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages (conversation_id);

CREATE TABLE IF NOT EXISTS agent_memory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- deck-scoped, per-card, ordered tag list. Position is a stable slot (not a
-- compacted array index) so a card can have a real tag at position 0, an
-- explicit empty slot at position 1, and another real tag at position 2
-- without disturbing 0/2 when 1 is added/removed.
CREATE TABLE IF NOT EXISTS deck_card_tags (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_card_id   INTEGER NOT NULL REFERENCES deck_cards(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  tag_name       TEXT,
  is_placeholder INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_card_tags_deck_card_id ON deck_card_tags (deck_card_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deck_card_tags_unique_position ON deck_card_tags (deck_card_id, position);

-- one canonical color per (deck, tag name) so every card carrying a given
-- tag renders with the same group color.
CREATE TABLE IF NOT EXISTS deck_tag_colors (
  deck_id  INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  color    TEXT NOT NULL,
  PRIMARY KEY (deck_id, tag_name)
);

-- Named, independent, linear timelines of released versions for a deck.
-- Branches never merge back together; a branch's only purpose is to let a
-- version sequence diverge from a specific point without renumbering.
CREATE TABLE IF NOT EXISTS deck_branches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id            INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  is_root            INTEGER NOT NULL DEFAULT 0,
  parent_branch_id   INTEGER REFERENCES deck_branches(id) ON DELETE SET NULL,
  parent_version_id  INTEGER REFERENCES deck_versions(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(deck_id, name)
);
CREATE INDEX IF NOT EXISTS idx_deck_branches_deck_id ON deck_branches (deck_id);

-- A released, immutable snapshot of a branch's card list + tags +
-- arrangements at one point in time. Cards/tags are keyed by oracle_id
-- (not deck_cards.id) since restoring re-inserts fresh rows with new ids.
CREATE TABLE IF NOT EXISTS deck_versions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id         INTEGER NOT NULL REFERENCES deck_branches(id) ON DELETE CASCADE,
  version_number    INTEGER NOT NULL,
  message           TEXT,
  cards_json        TEXT NOT NULL,
  tags_json         TEXT NOT NULL,
  arrangements_json TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(branch_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_deck_versions_branch_id ON deck_versions (branch_id);
`;

function initLibrary(userDir) {
  require('fs').mkdirSync(userDir, { recursive: true });
  const dbPath = path.join(userDir, 'library.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Additive migrations for columns added after initial release
  try { db.exec('ALTER TABLE decks ADD COLUMN cover_image_url TEXT'); } catch {}
  try { db.exec('ALTER TABLE decks ADD COLUMN recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL'); } catch {}
  try { db.exec('ALTER TABLE deck_cards ADD COLUMN is_proxy INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE collection ADD COLUMN recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_collection_owner_oracle ON collection (oracle_id, recipient_id, scryfall_id)'); } catch {}
  try { db.exec('ALTER TABLE ai_conversations ADD COLUMN declined_oracle_ids TEXT'); } catch {}
  try { db.exec('ALTER TABLE ai_conversations ADD COLUMN session_handle TEXT'); } catch {}
  try { db.exec("ALTER TABLE arrangements ADD COLUMN grouping_level INTEGER NOT NULL DEFAULT 1"); } catch {}
  try { db.exec('ALTER TABLE decks ADD COLUMN active_branch_id INTEGER REFERENCES deck_branches(id) ON DELETE SET NULL'); } catch {}
  migrateCanvasGroupsToTags(db);
  backfillRootBranches(db);
  return db;
}

// Idempotent: gives every deck lacking a branch a protected root branch
// ('main') with zero versions yet. Runs on every startup (cheap no-op once
// all decks have one) rather than a one-shot PRAGMA gate, so it also covers
// decks created between app updates.
function backfillRootBranches(db) {
  const deckIds = db.prepare('SELECT id FROM decks WHERE active_branch_id IS NULL').all().map(r => r.id);
  if (deckIds.length === 0) return;
  const tx = db.transaction(() => {
    for (const deckId of deckIds) ensureRootBranch(db, deckId);
  });
  tx();
}

function ensureRootBranch(db, deckId) {
  const existing = db.prepare('SELECT active_branch_id FROM decks WHERE id = ?').get(deckId);
  if (!existing) return null;
  if (existing.active_branch_id) return existing.active_branch_id;
  const res = db.prepare("INSERT INTO deck_branches (deck_id, name, is_root) VALUES (?, 'main', 1)").run(deckId);
  db.prepare('UPDATE decks SET active_branch_id = ? WHERE id = ?').run(res.lastInsertRowid, deckId);
  return res.lastInsertRowid;
}

// One-shot, forward-only: seeds deck_card_tags/deck_tag_colors from existing
// canvas_json group membership so pre-existing arrangements keep rendering
// the same groups once grouping_level-based rendering replaces DOM-derived
// groups. Only adds a tag to cards that currently have zero tags — never
// touches canvas_json or overwrites a tag a user already set. Gated by
// PRAGMA user_version so it runs exactly once ever.
function migrateCanvasGroupsToTags(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version >= 1) return;

  const arrangements = db.prepare('SELECT id, deck_id, canvas_json FROM arrangements WHERE canvas_json IS NOT NULL').all();
  const tx = db.transaction(() => {
    for (const arr of arrangements) {
      let canvas;
      try { canvas = JSON.parse(arr.canvas_json); } catch { continue; }
      if (!canvas || !Array.isArray(canvas.groups)) continue;

      for (const g of canvas.groups) {
        if (!g || !g.name) continue;

        // DOM-authored shape: g.cards is an array of card snapshots, each
        // carrying entryId (== deck_cards.id) when available.
        const cardEntryIds = Array.isArray(g.cards)
          ? g.cards.map(c => c && c.entryId).filter(id => id != null)
          : [];
        // MCP-authored shape (create_canvas_group): g.oracleIds, no entryId —
        // resolve to this deck's deck_cards rows by oracle_id.
        const oracleIds = Array.isArray(g.oracleIds) ? g.oracleIds : [];
        const resolvedFromOracle = oracleIds.length
          ? db.prepare(`SELECT id FROM deck_cards WHERE deck_id = ? AND oracle_id = ?`)
          : null;

        const deckCardIds = new Set(cardEntryIds);
        if (resolvedFromOracle) {
          for (const oid of oracleIds) {
            const row = resolvedFromOracle.get(arr.deck_id, oid);
            if (row) deckCardIds.add(row.id);
          }
        }
        if (deckCardIds.size === 0) continue;

        const color = g.color || pickNextTagColor(db, arr.deck_id);
        ensureTagColor(db, { deckId: arr.deck_id, tagName: g.name, color });

        for (const deckCardId of deckCardIds) {
          const hasTags = db.prepare('SELECT 1 FROM deck_card_tags WHERE deck_card_id = ? LIMIT 1').get(deckCardId);
          if (hasTags) continue; // never overwrite an already-tagged card
          db.prepare('INSERT OR IGNORE INTO deck_card_tags (deck_card_id, position, tag_name) VALUES (?, 0, ?)')
            .run(deckCardId, g.name);
        }
      }
    }
  });
  tx();
  db.pragma('user_version = 1');
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

function getFolderTree(db) {
  const rows = db.prepare('SELECT * FROM folders ORDER BY sort_order, name').all();
  const map = {};
  rows.forEach(r => { map[r.id] = { ...r, children: [] }; });
  const roots = [];
  rows.forEach(r => {
    if (r.parent_id && map[r.parent_id]) {
      map[r.parent_id].children.push(map[r.id]);
    } else {
      roots.push(map[r.id]);
    }
  });
  return roots;
}

function createFolder(db, { name, parent_id = null, parentId = null, icon = 'folder' }) {
  // Accept both snake_case (renderer) and camelCase (legacy) spellings
  const pid = parent_id ?? parentId ?? null;
  const result = db
    .prepare('INSERT INTO folders (name, parent_id, icon) VALUES (?, ?, ?)')
    .run(name, pid, icon);
  return { id: result.lastInsertRowid };
}

function moveFolder(db, { id, parent_id = null }) {
  db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id, id);
  return { ok: true };
}

function renameFolder(db, { id, name }) {
  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id);
  return { ok: true };
}

function deleteFolder(db, { id }) {
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

function getDecks(db, { folderId = null } = {}) {
  if (folderId == null) {
    return db.prepare(`
      SELECT d.*, COALESCE(SUM(dc.quantity), 0) AS card_count,
             r.name AS recipient_name, r.type AS recipient_type
      FROM decks d
      LEFT JOIN deck_cards dc ON dc.deck_id = d.id
      LEFT JOIN recipients r ON r.id = d.recipient_id
      GROUP BY d.id
      ORDER BY d.sort_order, d.name
    `).all();
  }
  return db.prepare(`
    SELECT d.*, COALESCE(SUM(dc.quantity), 0) AS card_count,
           r.name AS recipient_name, r.type AS recipient_type
    FROM decks d
    LEFT JOIN deck_cards dc ON dc.deck_id = d.id
    LEFT JOIN recipients r ON r.id = d.recipient_id
    WHERE d.folder_id = ?
    GROUP BY d.id
    ORDER BY d.sort_order, d.name
  `).all(folderId);
}

function createDeck(db, { name, format = 'commander', folderId = null, colorIdentity = null }) {
  const result = db
    .prepare(
      'INSERT INTO decks (name, format, folder_id, color_identity) VALUES (?, ?, ?, ?)'
    )
    .run(name, format, folderId, colorIdentity);
  ensureRootBranch(db, result.lastInsertRowid);
  return { id: result.lastInsertRowid };
}

function getDeck(db, { id }) {
  const deck = db.prepare(`
    SELECT d.*, r.name AS recipient_name, r.type AS recipient_type
    FROM decks d
    LEFT JOIN recipients r ON r.id = d.recipient_id
    WHERE d.id = ?
  `).get(id);
  if (!deck) return null;
  const cards = db
    .prepare('SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY board, sort_order, added_at')
    .all(id);
  return { ...deck, cards };
}

function updateDeck(db, { id, ...fields }) {
  const allowed = [
    'name', 'format', 'folder_id', 'description', 'cover_scryfall_id',
    'cover_image_url', 'color_identity', 'power_level', 'is_favorite', 'sort_order',
    'recipient_id'
  ];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (updates.length === 0) return { ok: true };

  const setClauses = [...updates.map(k => `${k} = ?`), "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"];
  const values = updates.map(k => {
    const v = fields[k];
    if (k === 'color_identity') return Array.isArray(v) ? JSON.stringify(v) : (v ?? null);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  db.prepare(`UPDATE decks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values, id);
  return { ok: true };
}

function deleteDeck(db, { id }) {
  db.prepare('DELETE FROM decks WHERE id = ?').run(id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deck cards
// ---------------------------------------------------------------------------

function addCardToDeck(db, { deckId, oracleId, scryfallId = null, quantity = 1, board = 'main', category = null }) {
  const result = db
    .prepare(
      'INSERT INTO deck_cards (deck_id, oracle_id, scryfall_id, quantity, board, category) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(deckId, oracleId, scryfallId, quantity, board, category);
  db.prepare("UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(deckId);
  return { id: result.lastInsertRowid };
}

function removeCardFromDeck(db, { id }) {
  const row = db.prepare('DELETE FROM deck_cards WHERE id = ? RETURNING deck_id').get(id);
  if (row) db.prepare("UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(row.deck_id);
  return { ok: true };
}

function updateCardBoard(db, { id, board }) {
  const row = db.prepare('UPDATE deck_cards SET board = ? WHERE id = ? RETURNING deck_id').get(board, id);
  if (row) db.prepare("UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(row.deck_id);
  return { ok: true };
}

function updateCardQuantity(db, { id, quantity }) {
  const row = db.prepare('UPDATE deck_cards SET quantity = ? WHERE id = ? RETURNING deck_id').get(quantity, id);
  if (row) db.prepare("UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(row.deck_id);
  return { ok: true };
}

function moveDeck(db, { id, folderId }) {
  db.prepare("UPDATE decks SET folder_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(folderId ?? null, id);
  return { ok: true };
}

function duplicateDeck(db, { id }) {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(id);
  if (!deck) return null;
  const res = db.prepare(
    "INSERT INTO decks (folder_id, name, format, description, color_identity, power_level) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(deck.folder_id, `${deck.name} (Copy)`, deck.format, deck.description, deck.color_identity, deck.power_level);
  const newId = res.lastInsertRowid;
  const cards = db.prepare('SELECT * FROM deck_cards WHERE deck_id = ?').all(id);
  if (cards.length) {
    const insCard = db.prepare('INSERT INTO deck_cards (deck_id, oracle_id, scryfall_id, quantity, board, category) VALUES (?, ?, ?, ?, ?, ?)');
    const getTags = db.prepare('SELECT position, tag_name, is_placeholder FROM deck_card_tags WHERE deck_card_id = ?');
    const insTag = db.prepare('INSERT INTO deck_card_tags (deck_card_id, position, tag_name, is_placeholder) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (const c of cards) {
        const newCardId = insCard.run(newId, c.oracle_id, c.scryfall_id, c.quantity, c.board, c.category).lastInsertRowid;
        for (const t of getTags.all(c.id)) {
          insTag.run(newCardId, t.position, t.tag_name, t.is_placeholder);
          if (!t.is_placeholder) ensureTagColor(db, { deckId: newId, tagName: t.tag_name });
        }
      }
    })();
  }
  ensureRootBranch(db, newId);
  return { id: newId };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const TAG_COLOR_PALETTE = ['#f2ca83', '#bcd0ff', '#86efac', '#c4c6cd', '#d4aa7d', '#c084fc'];

function pickNextTagColor(db, deckId) {
  const used = db.prepare('SELECT color, COUNT(*) AS n FROM deck_tag_colors WHERE deck_id = ? GROUP BY color').all(deckId);
  const counts = new Map(TAG_COLOR_PALETTE.map(c => [c, 0]));
  for (const { color, n } of used) if (counts.has(color)) counts.set(color, n);
  let best = TAG_COLOR_PALETTE[0], bestCount = Infinity;
  for (const c of TAG_COLOR_PALETTE) {
    const n = counts.get(c);
    if (n < bestCount) { best = c; bestCount = n; }
  }
  return best;
}

function normalizeTagName(name) {
  return String(name).trim();
}

// Resolves the canonical stored casing for a tag name via case-insensitive
// match against tags already used in this deck; falls back to the as-typed
// name if this is a brand-new tag.
function resolveTagCasing(db, deckId, tagName) {
  const name = normalizeTagName(tagName);
  const existing = db.prepare(
    `SELECT tag_name FROM deck_card_tags dct
     JOIN deck_cards dc ON dc.id = dct.deck_card_id
     WHERE dc.deck_id = ? AND dct.is_placeholder = 0 AND LOWER(dct.tag_name) = LOWER(?)
     LIMIT 1`
  ).get(deckId, name);
  return existing ? existing.tag_name : name;
}

function getCardTags(db, { deckCardId }) {
  return db.prepare('SELECT position, tag_name, is_placeholder FROM deck_card_tags WHERE deck_card_id = ? ORDER BY position').all(deckCardId);
}

function getDeckTags(db, { deckId }) {
  return db.prepare(`
    SELECT dct.deck_card_id, dct.position, dct.tag_name, dct.is_placeholder
    FROM deck_card_tags dct
    JOIN deck_cards dc ON dc.id = dct.deck_card_id
    WHERE dc.deck_id = ?
    ORDER BY dct.deck_card_id, dct.position
  `).all(deckId);
}

function getDeckTagColors(db, { deckId }) {
  return db.prepare('SELECT tag_name, color FROM deck_tag_colors WHERE deck_id = ?').all(deckId);
}

function setTagColor(db, { deckId, tagName, color }) {
  db.prepare(`
    INSERT INTO deck_tag_colors (deck_id, tag_name, color) VALUES (?, ?, ?)
    ON CONFLICT(deck_id, tag_name) DO UPDATE SET color = excluded.color
  `).run(deckId, normalizeTagName(tagName), color);
  return { ok: true };
}

function ensureTagColor(db, { deckId, tagName, color = null }) {
  const name = normalizeTagName(tagName);
  const existing = db.prepare('SELECT color FROM deck_tag_colors WHERE deck_id = ? AND tag_name = ?').get(deckId, name);
  if (existing) return existing.color;
  const chosen = color || pickNextTagColor(db, deckId);
  setTagColor(db, { deckId, tagName: name, color: chosen });
  return chosen;
}

function deckIdForCard(db, deckCardId) {
  const row = db.prepare('SELECT deck_id FROM deck_cards WHERE id = ?').get(deckCardId);
  return row ? row.deck_id : null;
}

// Sets (creates or replaces) the tag at one stable position slot on a card.
// Pass tagName = null with isPlaceholder = true to mark the slot as an
// explicit "empty" — opts the card out of grouping at exactly this level,
// with no fallback to a lower position.
function setCardTagAt(db, { deckCardId, position, tagName, isPlaceholder = false }) {
  const deckId = deckIdForCard(db, deckCardId);
  const resolvedName = isPlaceholder ? null : resolveTagCasing(db, deckId, tagName);
  db.prepare(`
    INSERT INTO deck_card_tags (deck_card_id, position, tag_name, is_placeholder) VALUES (?, ?, ?, ?)
    ON CONFLICT(deck_card_id, position) DO UPDATE SET tag_name = excluded.tag_name, is_placeholder = excluded.is_placeholder
  `).run(deckCardId, position, resolvedName, isPlaceholder ? 1 : 0);
  if (!isPlaceholder && deckId != null) ensureTagColor(db, { deckId, tagName: resolvedName });
  return { ok: true };
}

// Clears a slot outright (deletes the row) — the level re-engages fallback
// to the next-lower real tag, distinct from setting an explicit placeholder.
function clearCardTagAt(db, { deckCardId, position }) {
  db.prepare('DELETE FROM deck_card_tags WHERE deck_card_id = ? AND position = ?').run(deckCardId, position);
  return { ok: true };
}

// Full replace of a card's tag list in priority order (index = position).
// Used by the chip editor for a single round-trip after reorder/add/remove.
function setCardTags(db, { deckCardId, tags }) {
  const deckId = deckIdForCard(db, deckCardId);
  db.transaction(() => {
    db.prepare('DELETE FROM deck_card_tags WHERE deck_card_id = ?').run(deckCardId);
    const ins = db.prepare('INSERT INTO deck_card_tags (deck_card_id, position, tag_name, is_placeholder) VALUES (?, ?, ?, ?)');
    tags.forEach((entry, i) => {
      if (entry == null) { ins.run(deckCardId, i, null, 1); return; }
      const name = resolveTagCasing(db, deckId, entry);
      ins.run(deckCardId, i, name, 0);
      if (deckId != null) ensureTagColor(db, { deckId, tagName: name });
    });
  })();
  return { ok: true };
}

function renameTagInDeck(db, { deckId, oldName, newName }) {
  const from = normalizeTagName(oldName), to = normalizeTagName(newName);
  db.transaction(() => {
    db.prepare(`
      UPDATE deck_card_tags SET tag_name = ?
      WHERE is_placeholder = 0 AND LOWER(tag_name) = LOWER(?)
        AND deck_card_id IN (SELECT id FROM deck_cards WHERE deck_id = ?)
    `).run(to, from, deckId);
    const oldColor = db.prepare('SELECT color FROM deck_tag_colors WHERE deck_id = ? AND tag_name = ?').get(deckId, from);
    if (oldColor) {
      db.prepare('DELETE FROM deck_tag_colors WHERE deck_id = ? AND tag_name = ?').run(deckId, from);
      setTagColor(db, { deckId, tagName: to, color: oldColor.color });
    }
  })();
  return { ok: true };
}

function deleteTagFromDeck(db, { deckId, tagName }) {
  const name = normalizeTagName(tagName);
  db.prepare(`
    DELETE FROM deck_card_tags
    WHERE is_placeholder = 0 AND LOWER(tag_name) = LOWER(?)
      AND deck_card_id IN (SELECT id FROM deck_cards WHERE deck_id = ?)
  `).run(name, deckId);
  db.prepare('DELETE FROM deck_tag_colors WHERE deck_id = ? AND tag_name = ?').run(deckId, name);
  return { ok: true };
}

function setArrangementGroupingLevel(db, { id, groupingLevel }) {
  db.prepare('UPDATE arrangements SET grouping_level = ? WHERE id = ?').run(groupingLevel, id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

function getRecipients(db) {
  return db.prepare('SELECT * FROM recipients ORDER BY name').all();
}

function createRecipient(db, { name, type = 'other', notes = null }) {
  const result = db.prepare('INSERT INTO recipients (name, type, notes) VALUES (?, ?, ?)').run(name, type, notes);
  return { id: result.lastInsertRowid };
}

function updateRecipient(db, { id, name, type, notes }) {
  db.prepare('UPDATE recipients SET name = ?, type = ?, notes = ? WHERE id = ?').run(name, type, notes ?? null, id);
  return { ok: true };
}

function deleteRecipient(db, { id }) {
  db.prepare('DELETE FROM recipients WHERE id = ?').run(id);
  return { ok: true };
}

function mountDeck(db, { id, recipientId }) {
  db.prepare("UPDATE decks SET recipient_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(recipientId, id);
  return { ok: true };
}

function unmountDeck(db, { id }) {
  db.prepare("UPDATE decks SET recipient_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function getCollection(db) {
  return db.prepare('SELECT * FROM collection ORDER BY added_at DESC').all();
}

function addToCollection(db, { oracleId, scryfallId = null, quantity = 1, foil = 0, condition = 'NM' }) {
  const result = db
    .prepare(
      'INSERT INTO collection (oracle_id, scryfall_id, quantity, foil, condition) VALUES (?, ?, ?, ?, ?)'
    )
    .run(oracleId, scryfallId, quantity, foil ? 1 : 0, condition);
  return { id: result.lastInsertRowid };
}

function removeFromCollection(db, { id }) {
  db.prepare('DELETE FROM collection WHERE id = ?').run(id);
  return { ok: true };
}

function updateCollectionEntry(db, { id, quantity, condition, foil, acquiredPrice, recipientId }) {
  db.prepare('UPDATE collection SET quantity = ?, condition = ?, foil = ?, acquired_price_usd = ?, recipient_id = ? WHERE id = ?')
    .run(quantity, condition, foil ? 1 : 0, acquiredPrice ?? null, recipientId ?? null, id);
  return { ok: true };
}

function getDeckCardStatuses(db, { deckId }) {
  // Single LEFT JOIN with conditional aggregation replaces three correlated subqueries per row
  const rows = db.prepare(`
    SELECT
      dc.oracle_id,
      dc.scryfall_id AS deck_scryfall,
      dc.is_proxy,
      d.recipient_id,
      COALESCE(SUM(CASE WHEN c.recipient_id = d.recipient_id AND c.scryfall_id = dc.scryfall_id THEN c.quantity ELSE 0 END), 0) AS in_recipient_same,
      COALESCE(SUM(CASE WHEN c.recipient_id = d.recipient_id THEN c.quantity ELSE 0 END), 0) AS in_recipient_any,
      COALESCE(SUM(c.quantity), 0) AS in_collection_any
    FROM deck_cards dc
    JOIN decks d ON d.id = dc.deck_id
    LEFT JOIN collection c ON c.oracle_id = dc.oracle_id
    WHERE dc.deck_id = ?
    GROUP BY dc.oracle_id, dc.scryfall_id, dc.is_proxy, d.recipient_id
  `).all(deckId);

  const result = {};
  for (const row of rows) {
    if (row.is_proxy) {
      result[row.oracle_id] = 'proxy';
    } else if (row.recipient_id && row.in_recipient_same > 0) {
      result[row.oracle_id] = 'in-recipient';
    } else if (row.recipient_id && row.in_recipient_any > 0) {
      result[row.oracle_id] = 'in-recipient-diff';
    } else if (row.in_collection_any > 0) {
      result[row.oracle_id] = 'in-collection';
    } else {
      result[row.oracle_id] = 'missing';
    }
  }
  return result;
}

function updateCardProxy(db, { id, isProxy }) {
  db.prepare('UPDATE deck_cards SET is_proxy = ? WHERE id = ?').run(isProxy ? 1 : 0, id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

function getWishlist(db) {
  return db.prepare('SELECT * FROM wishlist ORDER BY priority DESC, added_at DESC').all();
}

function addToWishlist(db, { oracleId, scryfallId = null, quantity = 1, priority = 0, notes = null }) {
  const result = db
    .prepare(
      'INSERT INTO wishlist (oracle_id, scryfall_id, quantity, priority, notes) VALUES (?, ?, ?, ?, ?)'
    )
    .run(oracleId, scryfallId, quantity, priority, notes);
  return { id: result.lastInsertRowid };
}

function removeFromWishlist(db, { id }) {
  db.prepare('DELETE FROM wishlist WHERE id = ?').run(id);
  return { ok: true };
}

function updateWishlistEntry(db, { id, quantity, priority, note }) {
  db.prepare('UPDATE wishlist SET quantity = ?, priority = ?, notes = ? WHERE id = ?').run(quantity, priority, note ?? null, id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Canvas states
// ---------------------------------------------------------------------------

function saveCanvas(db, { deckId, stateJson }) {
  db.prepare(`
    INSERT INTO canvas_states (deck_id, state_json, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(deck_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `).run(deckId, stateJson);
  return { ok: true };
}

function loadCanvas(db, { deckId }) {
  const row = db.prepare('SELECT state_json FROM canvas_states WHERE deck_id = ?').get(deckId);
  return row ? { stateJson: row.state_json } : null;
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

function logActivity(db, { event, deckId = null, oracleId = null }) {
  db.prepare('INSERT INTO activity_log (event, deck_id, oracle_id) VALUES (?, ?, ?)').run(event, deckId, oracleId);
  return { ok: true };
}

function getActivityLog(db, { days = 7 } = {}) {
  return db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count
    FROM activity_log
    WHERE created_at >= date('now', ?)
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all(`-${days} days`);
}

// ---------------------------------------------------------------------------
// Arrangements
// ---------------------------------------------------------------------------

function getArrangements(db, { deckId }) {
  return db.prepare('SELECT * FROM arrangements WHERE deck_id = ? ORDER BY sort_order, created_at').all(deckId);
}

function getArrangementById(db, { id }) {
  return db.prepare('SELECT * FROM arrangements WHERE id = ?').get(id);
}

function createArrangement(db, { deckId, name = 'Default' }) {
  const result = db.prepare('INSERT INTO arrangements (deck_id, name) VALUES (?, ?)').run(deckId, name);
  return { id: result.lastInsertRowid };
}

function renameArrangement(db, { id, name }) {
  db.prepare('UPDATE arrangements SET name = ? WHERE id = ?').run(name, id);
  return { ok: true };
}

function deleteArrangement(db, { id }) {
  db.prepare('DELETE FROM arrangements WHERE id = ?').run(id);
  return { ok: true };
}

function saveArrangementCanvas(db, { id, canvasJson }) {
  db.prepare('UPDATE arrangements SET canvas_json = ? WHERE id = ?').run(canvasJson, id);
  return { ok: true };
}

function loadArrangementCanvas(db, { id }) {
  const row = db.prepare('SELECT canvas_json FROM arrangements WHERE id = ?').get(id);
  return row ? { canvasJson: row.canvas_json } : null;
}

// ---------------------------------------------------------------------------
// Branches & Versions
//
// A branch is a named, independent, linear sequence of released versions —
// branches never merge back together. `deck_cards`/`deck_card_tags`/
// `arrangements` are always the live working copy of whichever branch is
// currently checked out (decks.active_branch_id); a "release" snapshots
// that working state into an immutable deck_versions row. Cards/tags are
// keyed by (oracle_id, board) rather than deck_cards.id, since restoring a
// snapshot re-inserts fresh rows with new autoincrement ids.
// ---------------------------------------------------------------------------

function snapshotDeckContent(db, deckId) {
  const cards = db.prepare(
    'SELECT oracle_id, scryfall_id, quantity, board, category, sort_order, is_proxy FROM deck_cards WHERE deck_id = ? ORDER BY board, sort_order, added_at'
  ).all(deckId);
  const tags = db.prepare(`
    SELECT dc.oracle_id, dc.board, t.position, t.tag_name, t.is_placeholder
    FROM deck_card_tags t
    JOIN deck_cards dc ON dc.id = t.deck_card_id
    WHERE dc.deck_id = ?
    ORDER BY dc.oracle_id, dc.board, t.position
  `).all(deckId);
  const arrangements = db.prepare(
    'SELECT name, canvas_json, grouping_level, sort_order FROM arrangements WHERE deck_id = ? ORDER BY sort_order, created_at'
  ).all(deckId);
  return {
    cardsJson: JSON.stringify(cards),
    tagsJson: JSON.stringify(tags),
    arrangementsJson: JSON.stringify(arrangements),
  };
}

function materializeSnapshot(db, deckId, version) {
  const cards = JSON.parse(version.cards_json);
  const tags = JSON.parse(version.tags_json);
  const arrangements = JSON.parse(version.arrangements_json);

  db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId);
  db.prepare('DELETE FROM arrangements WHERE deck_id = ?').run(deckId);

  const insCard = db.prepare(
    'INSERT INTO deck_cards (deck_id, oracle_id, scryfall_id, quantity, board, category, sort_order, is_proxy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const idByKey = new Map();
  for (const c of cards) {
    const res = insCard.run(deckId, c.oracle_id, c.scryfall_id ?? null, c.quantity, c.board, c.category ?? null, c.sort_order ?? 0, c.is_proxy ?? 0);
    idByKey.set(`${c.oracle_id}::${c.board}`, res.lastInsertRowid);
  }

  const insTag = db.prepare('INSERT INTO deck_card_tags (deck_card_id, position, tag_name, is_placeholder) VALUES (?, ?, ?, ?)');
  for (const t of tags) {
    const deckCardId = idByKey.get(`${t.oracle_id}::${t.board}`);
    if (deckCardId == null) continue;
    insTag.run(deckCardId, t.position, t.tag_name ?? null, t.is_placeholder ? 1 : 0);
  }

  const insArr = db.prepare('INSERT INTO arrangements (deck_id, name, canvas_json, sort_order, grouping_level) VALUES (?, ?, ?, ?, ?)');
  for (const a of arrangements) {
    insArr.run(deckId, a.name, a.canvas_json ?? null, a.sort_order ?? 0, a.grouping_level ?? 1);
  }
}

function getTipVersion(db, branchId) {
  return db.prepare('SELECT * FROM deck_versions WHERE branch_id = ? ORDER BY version_number DESC LIMIT 1').get(branchId);
}

function isDeckDirty(db, { deckId }) {
  const deck = db.prepare('SELECT active_branch_id FROM decks WHERE id = ?').get(deckId);
  if (!deck || !deck.active_branch_id) return false;
  const tip = getTipVersion(db, deck.active_branch_id);
  const current = snapshotDeckContent(db, deckId);
  if (!tip) return JSON.parse(current.cardsJson).length > 0;
  return current.cardsJson !== tip.cards_json
    || current.tagsJson !== tip.tags_json
    || current.arrangementsJson !== tip.arrangements_json;
}

function getBranches(db, { deckId }) {
  const deck = db.prepare('SELECT active_branch_id FROM decks WHERE id = ?').get(deckId);
  const branches = db.prepare('SELECT * FROM deck_branches WHERE deck_id = ? ORDER BY is_root DESC, created_at').all(deckId);
  return branches.map(b => {
    const tip = getTipVersion(db, b.id);
    const isActive = !!deck && deck.active_branch_id === b.id;
    return {
      ...b,
      tip_version_number: tip ? tip.version_number : 0,
      tip_message: tip ? tip.message : null,
      tip_created_at: tip ? tip.created_at : null,
      is_active: isActive,
      is_dirty: isActive ? isDeckDirty(db, { deckId }) : false,
    };
  });
}

function createBranch(db, { deckId, name, sourceVersionId }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Branch name is required');
  const sourceVersion = db.prepare(`
    SELECT v.*, b.deck_id AS branch_deck_id
    FROM deck_versions v JOIN deck_branches b ON b.id = v.branch_id
    WHERE v.id = ?
  `).get(sourceVersionId);
  if (!sourceVersion || sourceVersion.branch_deck_id !== deckId) {
    throw new Error('Source version does not belong to this deck');
  }

  return db.transaction(() => {
    const res = db.prepare(
      'INSERT INTO deck_branches (deck_id, name, is_root, parent_branch_id, parent_version_id) VALUES (?, ?, 0, ?, ?)'
    ).run(deckId, trimmedName, sourceVersion.branch_id, sourceVersionId);
    const branchId = res.lastInsertRowid;
    db.prepare(
      'INSERT INTO deck_versions (branch_id, version_number, message, cards_json, tags_json, arrangements_json) VALUES (?, 1, ?, ?, ?, ?)'
    ).run(branchId, `Branched at v${sourceVersion.version_number}`, sourceVersion.cards_json, sourceVersion.tags_json, sourceVersion.arrangements_json);
    return { id: branchId };
  })();
}

function renameBranch(db, { id, name }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Branch name is required');
  db.prepare('UPDATE deck_branches SET name = ? WHERE id = ?').run(trimmedName, id);
  return { ok: true };
}

function deleteBranch(db, { id }) {
  const branch = db.prepare('SELECT * FROM deck_branches WHERE id = ?').get(id);
  if (!branch) return { ok: true };
  if (branch.is_root) throw new Error('The root branch cannot be deleted');
  const deck = db.prepare('SELECT active_branch_id FROM decks WHERE id = ?').get(branch.deck_id);
  if (deck && deck.active_branch_id === id) throw new Error('Cannot delete the currently active branch');
  db.prepare('DELETE FROM deck_branches WHERE id = ?').run(id);
  return { ok: true };
}

function getVersions(db, { branchId }) {
  const rows = db.prepare(
    'SELECT id, branch_id, version_number, message, created_at, cards_json FROM deck_versions WHERE branch_id = ? ORDER BY version_number DESC'
  ).all(branchId);
  return rows.map(r => {
    let cardCount = 0;
    try { cardCount = JSON.parse(r.cards_json).reduce((sum, c) => sum + (c.quantity || 0), 0); } catch {}
    const { cards_json, ...rest } = r;
    return { ...rest, card_count: cardCount };
  });
}

function releaseVersion(db, { branchId, message = null }) {
  const branch = db.prepare('SELECT * FROM deck_branches WHERE id = ?').get(branchId);
  if (!branch) throw new Error('Branch not found');
  const snapshot = snapshotDeckContent(db, branch.deck_id);
  const nextNumber = (getTipVersion(db, branchId)?.version_number || 0) + 1;
  const res = db.prepare(
    'INSERT INTO deck_versions (branch_id, version_number, message, cards_json, tags_json, arrangements_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(branchId, nextNumber, message, snapshot.cardsJson, snapshot.tagsJson, snapshot.arrangementsJson);
  return { id: res.lastInsertRowid, version_number: nextNumber };
}

function getVersionDiff(db, { versionAId, versionBId }) {
  const a = db.prepare('SELECT cards_json FROM deck_versions WHERE id = ?').get(versionAId);
  const b = db.prepare('SELECT cards_json FROM deck_versions WHERE id = ?').get(versionBId);
  if (!a || !b) throw new Error('Version not found');
  const mapA = new Map(JSON.parse(a.cards_json).map(c => [`${c.oracle_id}::${c.board}`, c]));
  const mapB = new Map(JSON.parse(b.cards_json).map(c => [`${c.oracle_id}::${c.board}`, c]));

  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, cardB] of mapB) {
    const cardA = mapA.get(key);
    if (!cardA) { added.push(cardB); continue; }
    if (cardA.quantity !== cardB.quantity) {
      changed.push({ oracle_id: cardB.oracle_id, board: cardB.board, from_quantity: cardA.quantity, to_quantity: cardB.quantity });
    }
  }
  for (const [key, cardA] of mapA) {
    if (!mapB.has(key)) removed.push(cardA);
  }
  return { added, removed, changed };
}

// Both switchBranch and restoreVersion share this contract: if the deck has
// unreleased local changes, `onDirty` must be 'release' or 'discard' or the
// call throws a DECK_DIRTY error for the caller to show a confirmation modal.
function applyDirtyChoice(db, deckId, activeBranchId, onDirty, message) {
  const dirty = isDeckDirty(db, { deckId });
  if (dirty && !onDirty) {
    const err = new Error('DECK_DIRTY');
    err.code = 'DECK_DIRTY';
    throw err;
  }
  if (dirty && onDirty === 'release') {
    releaseVersion(db, { branchId: activeBranchId, message: message || 'Autosaved before switching' });
  }
}

function switchBranch(db, { deckId, targetBranchId, onDirty = null, message = null }) {
  const deck = db.prepare('SELECT active_branch_id FROM decks WHERE id = ?').get(deckId);
  if (!deck) throw new Error('Deck not found');
  const targetBranch = db.prepare('SELECT * FROM deck_branches WHERE id = ? AND deck_id = ?').get(targetBranchId, deckId);
  if (!targetBranch) throw new Error('Branch not found');
  if (deck.active_branch_id === targetBranchId) return { ok: true };

  applyDirtyChoice(db, deckId, deck.active_branch_id, onDirty, message);

  return db.transaction(() => {
    const tip = getTipVersion(db, targetBranchId);
    if (tip) materializeSnapshot(db, deckId, tip);
    db.prepare("UPDATE decks SET active_branch_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(targetBranchId, deckId);
    return { ok: true };
  })();
}

function restoreVersion(db, { versionId, onDirty = null, message = null }) {
  const version = db.prepare(`
    SELECT v.*, b.deck_id AS deck_id, b.id AS branch_id
    FROM deck_versions v JOIN deck_branches b ON b.id = v.branch_id
    WHERE v.id = ?
  `).get(versionId);
  if (!version) throw new Error('Version not found');
  const deck = db.prepare('SELECT active_branch_id FROM decks WHERE id = ?').get(version.deck_id);
  if (!deck) throw new Error('Deck not found');

  applyDirtyChoice(db, version.deck_id, deck.active_branch_id, onDirty, message);

  return db.transaction(() => {
    materializeSnapshot(db, version.deck_id, version);
    if (deck.active_branch_id !== version.branch_id) {
      db.prepare("UPDATE decks SET active_branch_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(version.branch_id, version.deck_id);
    } else {
      db.prepare("UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(version.deck_id);
    }
    return { ok: true };
  })();
}

// ---------------------------------------------------------------------------
// AI Conversations
// ---------------------------------------------------------------------------

function createAIConversation(db, { deckId = null, title = null } = {}) {
  const result = db
    .prepare('INSERT INTO ai_conversations (deck_id, title) VALUES (?, ?)')
    .run(deckId, title);
  return { id: result.lastInsertRowid };
}

function getAIConversation(db, { id }) {
  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
  if (!conv) return null;
  const messages = db
    .prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(id)
    .map(m => ({
      ...m,
      ui_blocks: m.ui_blocks ? JSON.parse(m.ui_blocks) : null,
    }));
  return { ...conv, messages };
}

function getAIConversations(db, { deckId } = {}) {
  if (deckId != null) {
    return db
      .prepare('SELECT * FROM ai_conversations WHERE deck_id = ? ORDER BY created_at DESC')
      .all(deckId);
  }
  return db.prepare('SELECT * FROM ai_conversations ORDER BY created_at DESC').all();
}

function deleteAIConversation(db, { id }) {
  db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id);
  return { ok: true };
}

function getDeclinedOracleIds(db, { conversationId }) {
  const row = db.prepare('SELECT declined_oracle_ids FROM ai_conversations WHERE id = ?').get(conversationId);
  if (!row || !row.declined_oracle_ids) return [];
  try { return JSON.parse(row.declined_oracle_ids); } catch { return []; }
}

function addDeclinedOracleId(db, { conversationId, oracleId }) {
  const current = getDeclinedOracleIds(db, { conversationId });
  if (current.includes(oracleId)) return { ok: true };
  const updated = [...current, oracleId];
  db.prepare('UPDATE ai_conversations SET declined_oracle_ids = ? WHERE id = ?')
    .run(JSON.stringify(updated), conversationId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AI Messages
// ---------------------------------------------------------------------------

function appendAIMessage(db, { conversationId, role, content, uiBlocks = null }) {
  const result = db
    .prepare('INSERT INTO ai_messages (conversation_id, role, content, ui_blocks) VALUES (?, ?, ?, ?)')
    .run(conversationId, role, content, uiBlocks ? JSON.stringify(uiBlocks) : null);
  return { id: result.lastInsertRowid };
}

function getMostUsedCards(db, { limit = 10 } = {}) {
  return db.prepare(`
    SELECT dc.oracle_id, COUNT(DISTINCT dc.deck_id) AS deck_count
    FROM deck_cards dc
    WHERE dc.board NOT IN ('sideboard')
    GROUP BY dc.oracle_id
    ORDER BY deck_count DESC
    LIMIT ?
  `).all(limit);
}

function getDecksWithCard(db, { oracleId, excludeDeckId = null }) {
  let sql = `
    SELECT DISTINCT d.id, d.name
    FROM deck_cards dc
    JOIN decks d ON d.id = dc.deck_id
    WHERE dc.oracle_id = ? AND dc.board != 'sideboard'
  `;
  const params = [oracleId];
  if (excludeDeckId != null) {
    sql += ' AND d.id != ?';
    params.push(excludeDeckId);
  }
  sql += ' ORDER BY d.name LIMIT 20';
  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Agent Memory
// ---------------------------------------------------------------------------

function getAgentMemories(db) {
  return db.prepare('SELECT key, value, updated_at FROM agent_memory ORDER BY updated_at DESC').all();
}

function upsertAgentMemory(db, { key, value }) {
  db.prepare(`
    INSERT INTO agent_memory (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `).run(key, value);
  return { ok: true };
}

function deleteAgentMemory(db, { key }) {
  db.prepare('DELETE FROM agent_memory WHERE key = ?').run(key);
  return { ok: true };
}

function getAIMessages(db, { conversationId, limit = 20 }) {
  const rows = db
    .prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(conversationId, limit);
  // Return oldest-first
  return rows.reverse().map(m => ({
    ...m,
    ui_blocks: m.ui_blocks ? JSON.parse(m.ui_blocks) : null,
  }));
}

module.exports = {
  initLibrary,
  getFolderTree,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  getDecks,
  createDeck,
  getDeck,
  updateDeck,
  deleteDeck,
  moveDeck,
  duplicateDeck,
  addCardToDeck,
  removeCardFromDeck,
  updateCardBoard,
  updateCardQuantity,
  getCardTags,
  getDeckTags,
  getDeckTagColors,
  setTagColor,
  ensureTagColor,
  setCardTagAt,
  clearCardTagAt,
  setCardTags,
  renameTagInDeck,
  deleteTagFromDeck,
  setArrangementGroupingLevel,
  getRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  mountDeck,
  unmountDeck,
  getCollection,
  addToCollection,
  removeFromCollection,
  updateCollectionEntry,
  getDeckCardStatuses,
  updateCardProxy,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  updateWishlistEntry,
  logActivity,
  getActivityLog,
  saveCanvas,
  loadCanvas,
  getArrangements,
  getArrangementById,
  createArrangement,
  renameArrangement,
  deleteArrangement,
  saveArrangementCanvas,
  loadArrangementCanvas,
  getBranches,
  createBranch,
  renameBranch,
  deleteBranch,
  getVersions,
  releaseVersion,
  getVersionDiff,
  isDeckDirty,
  switchBranch,
  restoreVersion,
  createAIConversation,
  getAIConversation,
  getAIConversations,
  deleteAIConversation,
  getDeclinedOracleIds,
  addDeclinedOracleId,
  appendAIMessage,
  getAIMessages,
  getMostUsedCards,
  getDecksWithCard,
  getAgentMemories,
  upsertAgentMemory,
  deleteAgentMemory,
  updateCardPrint,
};

function updateCardPrint(db, { id, scryfallId }) {
  db.prepare('UPDATE deck_cards SET scryfall_id = ? WHERE id = ?').run(scryfallId, id);
  return { ok: true };
}
