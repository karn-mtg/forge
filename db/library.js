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
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id          ON deck_cards (deck_id);
CREATE INDEX IF NOT EXISTS idx_arrangements_deck_id        ON arrangements (deck_id);
CREATE INDEX IF NOT EXISTS idx_collection_oracle_id        ON collection (oracle_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_oracle_id          ON wishlist (oracle_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_deck_id        ON activity_log (deck_id);
CREATE INDEX IF NOT EXISTS idx_collection_added_at         ON collection (added_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishlist_sort               ON wishlist (priority DESC, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_owner_oracle     ON collection (oracle_id, recipient_id, scryfall_id);
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
  try { db.exec('ALTER TABLE ai_conversations ADD COLUMN declined_oracle_ids TEXT'); } catch {}
  try { db.exec('ALTER TABLE ai_conversations ADD COLUMN session_handle TEXT'); } catch {}
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
    const ins = db.prepare('INSERT INTO deck_cards (deck_id, oracle_id, scryfall_id, quantity, board, category) VALUES (?, ?, ?, ?, ?, ?)');
    db.transaction(() => { for (const c of cards) ins.run(newId, c.oracle_id, c.scryfall_id, c.quantity, c.board, c.category); })();
  }
  return { id: newId };
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
  createArrangement,
  renameArrangement,
  deleteArrangement,
  saveArrangementCanvas,
  loadArrangementCanvas,
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
