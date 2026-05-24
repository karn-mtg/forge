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
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id    ON deck_cards (deck_id);
CREATE INDEX IF NOT EXISTS idx_arrangements_deck_id  ON arrangements (deck_id);
CREATE INDEX IF NOT EXISTS idx_collection_oracle_id  ON collection (oracle_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_oracle_id    ON wishlist (oracle_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_deck_id  ON activity_log (deck_id);
`;

function initLibrary(userDataPath) {
  const dbPath = path.join(userDataPath, 'library.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Additive migrations for columns added after initial release
  try { db.exec('ALTER TABLE decks ADD COLUMN cover_image_url TEXT'); } catch {}
  return db;
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

function createFolder(db, { name, parentId = null, icon = 'folder' }) {
  const result = db
    .prepare('INSERT INTO folders (name, parent_id, icon) VALUES (?, ?, ?)')
    .run(name, parentId, icon);
  return { id: result.lastInsertRowid };
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
  // Fix #5: replace correlated subquery with a single LEFT JOIN + GROUP BY
  if (folderId == null) {
    return db.prepare(`
      SELECT d.*, COALESCE(SUM(dc.quantity), 0) AS card_count
      FROM decks d
      LEFT JOIN deck_cards dc ON dc.deck_id = d.id
      GROUP BY d.id
      ORDER BY d.sort_order, d.name
    `).all();
  }
  return db.prepare(`
    SELECT d.*, COALESCE(SUM(dc.quantity), 0) AS card_count
    FROM decks d
    LEFT JOIN deck_cards dc ON dc.deck_id = d.id
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
  return { id: result.lastInsertRowid };
}

function getDeck(db, { id }) {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(id);
  if (!deck) return null;
  const cards = db
    .prepare('SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY board, sort_order, added_at')
    .all(id);
  return { ...deck, cards };
}

function updateDeck(db, { id, ...fields }) {
  const allowed = [
    'name', 'format', 'folder_id', 'description', 'cover_scryfall_id',
    'cover_image_url', 'color_identity', 'power_level', 'is_favorite', 'sort_order'
  ];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (updates.length === 0) return { ok: true };

  const setClauses = [...updates.map(k => `${k} = ?`), "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"];
  const values = updates.map(k => fields[k]);
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
  const row = db.prepare('SELECT deck_id FROM deck_cards WHERE id = ?').get(id);
  db.prepare('DELETE FROM deck_cards WHERE id = ?').run(id);
  if (row) db.prepare("UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(row.deck_id);
  return { ok: true };
}

function updateCardBoard(db, { id, board }) {
  const row = db.prepare('SELECT deck_id FROM deck_cards WHERE id = ?').get(id);
  db.prepare('UPDATE deck_cards SET board = ? WHERE id = ?').run(board, id);
  if (row) db.prepare("UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(row.deck_id);
  return { ok: true };
}

function updateCardQuantity(db, { id, quantity }) {
  const row = db.prepare('SELECT deck_id FROM deck_cards WHERE id = ?').get(id);
  db.prepare('UPDATE deck_cards SET quantity = ? WHERE id = ?').run(quantity, id);
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
    const ins = db.prepare('INSERT INTO deck_cards (deck_id, oracle_id, scryfall_id, quantity, board, category) VALUES (?, ?, ?, ?, ?, ?)');
    db.transaction(() => { for (const c of cards) ins.run(newId, c.oracle_id, c.scryfall_id, c.quantity, c.board, c.category); })();
  }
  return { id: newId };
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

function updateCollectionEntry(db, { id, quantity, condition, foil, acquiredPrice }) {
  db.prepare('UPDATE collection SET quantity = ?, condition = ?, foil = ?, acquired_price_usd = ? WHERE id = ?')
    .run(quantity, condition, foil ? 1 : 0, acquiredPrice ?? null, id);
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

module.exports = {
  initLibrary,
  getFolderTree,
  createFolder,
  renameFolder,
  deleteFolder,
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
  getCollection,
  addToCollection,
  removeFromCollection,
  updateCollectionEntry,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  updateWishlistEntry,
  logActivity,
  getActivityLog,
  saveCanvas,
  loadCanvas,
  getArrangements,
  createArrangement,
  renameArrangement,
  deleteArrangement,
  saveArrangementCanvas,
  loadArrangementCanvas,
};
