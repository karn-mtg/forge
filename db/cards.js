'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;

  CREATE TABLE IF NOT EXISTS cards (
    oracle_id        TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    lang             TEXT,
    layout           TEXT,
    mana_cost        TEXT,
    cmc              REAL,
    type_line        TEXT,
    oracle_text      TEXT,
    power            TEXT,
    toughness        TEXT,
    loyalty          TEXT,
    defense          TEXT,
    hand_modifier    TEXT,
    life_modifier    TEXT,
    colors           TEXT,
    color_identity   TEXT,
    produced_mana    TEXT,
    keywords         TEXT,
    legalities       TEXT,
    games            TEXT,
    reserved         INTEGER,
    edhrec_rank      INTEGER,
    penny_rank       INTEGER,
    all_parts        TEXT,
    prices           TEXT,
    purchase_uris    TEXT,
    rulings_uri      TEXT,
    scryfall_uri     TEXT,
    sets             TEXT,
    full_data        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id               TEXT PRIMARY KEY,
    oracle_id        TEXT,
    name             TEXT NOT NULL,
    layout           TEXT,
    type_line        TEXT,
    oracle_text      TEXT,
    power            TEXT,
    toughness        TEXT,
    colors           TEXT,
    color_identity   TEXT,
    keywords         TEXT,
    all_parts        TEXT,
    full_data        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_images (
    id               TEXT PRIMARY KEY,
    oracle_id        TEXT NOT NULL REFERENCES cards(oracle_id),
    set_code         TEXT,
    set_name         TEXT,
    set_type         TEXT,
    rarity           TEXT,
    released_at      TEXT,
    collector_number TEXT,
    artist           TEXT,
    frame            TEXT,
    frame_effects    TEXT,
    promo            INTEGER,
    reprint          INTEGER,
    variation        INTEGER,
    story_spotlight  INTEGER,
    prices           TEXT,
    purchase_uris    TEXT,
    image_uris       TEXT,
    card_faces       TEXT
  );

  CREATE TABLE IF NOT EXISTS token_images (
    id               TEXT PRIMARY KEY,
    token_oracle_id  TEXT,
    set_code         TEXT,
    set_name         TEXT,
    released_at      TEXT,
    collector_number TEXT,
    artist           TEXT,
    image_uris       TEXT,
    card_faces       TEXT
  );

  CREATE TABLE IF NOT EXISTS metadata (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    last_updated_at     TEXT,
    source_updated_at   TEXT,
    file_size           INTEGER,
    card_count          INTEGER,
    token_count         INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_cards_name       ON cards (name);
  CREATE INDEX IF NOT EXISTS idx_cards_type_line  ON cards (type_line);
  CREATE INDEX IF NOT EXISTS idx_cards_cmc        ON cards (cmc);
  CREATE INDEX IF NOT EXISTS idx_images_oracle_id ON card_images (oracle_id);
  CREATE INDEX IF NOT EXISTS idx_images_set_code  ON card_images (set_code);
  CREATE INDEX IF NOT EXISTS idx_tokens_name      ON tokens (name);

  -- Fix #1: FTS5 virtual table for full-text search (content table — no duplicate storage)
  CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
    name,
    type_line,
    oracle_text,
    content='cards',
    content_rowid='rowid'
  );
`;

function initCards(userDataPath) {
  const dbPath = path.join(userDataPath, 'cards.db');
  const db = new Database(dbPath);
  db.exec(SCHEMA);

  // Fix #1: If cards exist but FTS index is empty (e.g. first run after upgrade),
  // rebuild the FTS index so searches work immediately without a full re-sync.
  try {
    const cardCount = db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
    const ftsCount  = db.prepare('SELECT COUNT(*) AS n FROM cards_fts').get().n;
    if (cardCount > 0 && ftsCount === 0) {
      db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`);
    }
  } catch { /* FTS not critical on startup */ }

  return db;
}

// ---------------------------------------------------------------------------
// Fix #8: Prepared-statement cache
// better-sqlite3 prepare() compiles SQL on every call. During sync we call
// insertCard/insertToken/insertCardImage/insertTokenImage ~30 000 times each,
// so we compile once and reuse the same Statement object.
// ---------------------------------------------------------------------------

let _stmtDb   = null;   // tracks which db instance owns the cache
let _stmtCache = null;

function getStmts(db) {
  if (db === _stmtDb) return _stmtCache;
  _stmtDb = db;
  _stmtCache = {
    insertCard: db.prepare(`
      INSERT OR IGNORE INTO cards (
        oracle_id, name, lang, layout,
        mana_cost, cmc, type_line, oracle_text,
        power, toughness, loyalty, defense,
        hand_modifier, life_modifier,
        colors, color_identity, produced_mana,
        keywords, legalities, games,
        reserved, edhrec_rank, penny_rank,
        all_parts, prices, purchase_uris,
        rulings_uri, scryfall_uri,
        full_data
      ) VALUES (
        @oracle_id, @name, @lang, @layout,
        @mana_cost, @cmc, @type_line, @oracle_text,
        @power, @toughness, @loyalty, @defense,
        @hand_modifier, @life_modifier,
        @colors, @color_identity, @produced_mana,
        @keywords, @legalities, @games,
        @reserved, @edhrec_rank, @penny_rank,
        @all_parts, @prices, @purchase_uris,
        @rulings_uri, @scryfall_uri,
        @full_data
      )
    `),
    insertToken: db.prepare(`
      INSERT OR IGNORE INTO tokens (
        id, oracle_id, name, layout, type_line, oracle_text,
        power, toughness, colors, color_identity,
        keywords, all_parts, full_data
      ) VALUES (
        @id, @oracle_id, @name, @layout, @type_line, @oracle_text,
        @power, @toughness, @colors, @color_identity,
        @keywords, @all_parts, @full_data
      )
    `),
    insertCardImage: db.prepare(`
      INSERT OR IGNORE INTO card_images (
        id, oracle_id, set_code, set_name, set_type,
        rarity, released_at, collector_number, artist,
        frame, frame_effects,
        promo, reprint, variation, story_spotlight,
        prices, purchase_uris,
        image_uris, card_faces
      ) VALUES (
        @id, @oracle_id, @set_code, @set_name, @set_type,
        @rarity, @released_at, @collector_number, @artist,
        @frame, @frame_effects,
        @promo, @reprint, @variation, @story_spotlight,
        @prices, @purchase_uris,
        @image_uris, @card_faces
      )
    `),
    insertTokenImage: db.prepare(`
      INSERT OR IGNORE INTO token_images (
        id, token_oracle_id, set_code, set_name,
        released_at, collector_number, artist,
        image_uris, card_faces
      ) VALUES (
        @id, @token_oracle_id, @set_code, @set_name,
        @released_at, @collector_number, @artist,
        @image_uris, @card_faces
      )
    `),
  };
  return _stmtCache;
}

function toJson(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function fromJson(str) {
  if (str == null) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function getMetadata(db) {
  return db.prepare('SELECT * FROM metadata WHERE id = 1').get() || null;
}

function getCardCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
}

function getTokenCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM tokens').get().n;
}

function clearAll(db) {
  db.exec(`
    DELETE FROM token_images;
    DELETE FROM card_images;
    DELETE FROM tokens;
    DELETE FROM cards;
  `);
}

function insertCard(db, card) {
  getStmts(db).insertCard.run({
    oracle_id:      card.oracle_id || card.id,
    name:           card.name,
    lang:           card.lang || null,
    layout:         card.layout || null,
    mana_cost:      card.mana_cost || null,
    cmc:            card.cmc != null ? card.cmc : null,
    type_line:      card.type_line || null,
    oracle_text:    card.oracle_text || null,
    power:          card.power || null,
    toughness:      card.toughness || null,
    loyalty:        card.loyalty || null,
    defense:        card.defense || null,
    hand_modifier:  card.hand_modifier || null,
    life_modifier:  card.life_modifier || null,
    colors:         toJson(card.colors),
    color_identity: toJson(card.color_identity),
    produced_mana:  toJson(card.produced_mana),
    keywords:       toJson(card.keywords),
    legalities:     toJson(card.legalities),
    games:          toJson(card.games),
    reserved:       card.reserved ? 1 : 0,
    edhrec_rank:    card.edhrec_rank != null ? card.edhrec_rank : null,
    penny_rank:     card.penny_rank != null ? card.penny_rank : null,
    all_parts:      toJson(card.all_parts),
    prices:         toJson(card.prices),
    purchase_uris:  toJson(card.purchase_uris),
    rulings_uri:    card.rulings_uri || null,
    scryfall_uri:   card.scryfall_uri || null,
    full_data:      JSON.stringify(card),
  });
}

function insertToken(db, card) {
  getStmts(db).insertToken.run({
    id:             card.id,
    oracle_id:      card.oracle_id || null,
    name:           card.name,
    layout:         card.layout || null,
    type_line:      card.type_line || null,
    oracle_text:    card.oracle_text || null,
    power:          card.power || null,
    toughness:      card.toughness || null,
    colors:         toJson(card.colors),
    color_identity: toJson(card.color_identity),
    keywords:       toJson(card.keywords),
    all_parts:      toJson(card.all_parts),
    full_data:      JSON.stringify(card),
  });
}

function insertCardImage(db, card) {
  getStmts(db).insertCardImage.run({
    id:               card.id,
    oracle_id:        card.oracle_id || card.id,
    set_code:         card.set || null,
    set_name:         card.set_name || null,
    set_type:         card.set_type || null,
    rarity:           card.rarity || null,
    released_at:      card.released_at || null,
    collector_number: card.collector_number || null,
    artist:           card.artist || null,
    frame:            card.frame || null,
    frame_effects:    toJson(card.frame_effects),
    promo:            card.promo ? 1 : 0,
    reprint:          card.reprint ? 1 : 0,
    variation:        card.variation ? 1 : 0,
    story_spotlight:  card.story_spotlight ? 1 : 0,
    prices:           toJson(card.prices),
    purchase_uris:    toJson(card.purchase_uris),
    image_uris:       toJson(card.image_uris),
    card_faces:       toJson(card.card_faces),
  });
}

function insertTokenImage(db, card) {
  getStmts(db).insertTokenImage.run({
    id:               card.id,
    token_oracle_id:  card.oracle_id || null,
    set_code:         card.set || null,
    set_name:         card.set_name || null,
    released_at:      card.released_at || null,
    collector_number: card.collector_number || null,
    artist:           card.artist || null,
    image_uris:       toJson(card.image_uris),
    card_faces:       toJson(card.card_faces),
  });
}

function updateCardSets(db) {
  db.exec(`
    UPDATE cards
    SET sets = (
      SELECT json_group_array(set_code)
      FROM (
        SELECT DISTINCT set_code
        FROM card_images
        WHERE card_images.oracle_id = cards.oracle_id
          AND set_code IS NOT NULL
        ORDER BY set_code
      )
    )
  `);
}

function updateMetadata(db, { sourceUpdatedAt, fileSize, cardCount, tokenCount }) {
  db.prepare(`
    INSERT INTO metadata (id, last_updated_at, source_updated_at, file_size, card_count, token_count)
    VALUES (1, @now, @sourceUpdatedAt, @fileSize, @cardCount, @tokenCount)
    ON CONFLICT(id) DO UPDATE SET
      last_updated_at   = excluded.last_updated_at,
      source_updated_at = excluded.source_updated_at,
      file_size         = excluded.file_size,
      card_count        = excluded.card_count,
      token_count       = excluded.token_count
  `).run({
    now:            new Date().toISOString(),
    sourceUpdatedAt: sourceUpdatedAt || null,
    fileSize:        fileSize || 0,
    cardCount:       cardCount || 0,
    tokenCount:      tokenCount || 0,
  });
}

// ---------------------------------------------------------------------------
// Fix #1 + #2: FTS5-based search with server-side colour filtering
//
// Converts the user's query into FTS5 prefix tokens ("lightning"* "bolt"*)
// which hit the cards_fts index instead of doing a full table scan with LIKE.
// Color filters are applied as SQL WHERE clauses so the client never needs to
// post-filter results, and the full pageSize is always satisfied.
// ---------------------------------------------------------------------------

// ─── Per-filter WHERE builders ────────────────────────────────────────────────

// searchIn: 'all' searches name+type_line+oracle_text (default)
//           'name' restricts to the name column only
//           'oracle' restricts to the oracle_text column only
function toFtsQuery(q, searchIn = 'all') {
  const tokens = (q || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const tokenStr = tokens.map(t => `"${t.replace(/"/g, '""')}"*`).join(' ');
  if (searchIn === 'oracle') return `oracle_text : ${tokenStr}`;
  if (searchIn === 'name')   return `name : ${tokenStr}`;
  return tokenStr; // all columns
}

function buildColorWhere(colors) {
  if (!colors || !colors.length) return '';
  const clauses = colors.map(c =>
    c === 'C'
      ? `json_array_length(c.color_identity) = 0`
      : `c.color_identity LIKE '%"${c}"%'`
  );
  return `AND (${clauses.join(' OR ')})`;
}

// types come from a fixed set so inline is safe
function buildTypeWhere(types) {
  if (!types || !types.length) return '';
  const clauses = types.map(t => `lower(c.type_line) LIKE '%${t.toLowerCase()}%'`);
  return `AND (${clauses.join(' OR ')})`;
}

function buildCmcWhere(cmcMin, cmcMax) {
  const parts = [];
  if (cmcMin != null && cmcMin !== '') parts.push(`c.cmc >= ${Number(cmcMin)}`);
  if (cmcMax != null && cmcMax !== '') parts.push(`c.cmc <= ${Number(cmcMax)}`);
  return parts.length ? `AND ${parts.join(' AND ')}` : '';
}

// rarities come from a fixed set ('common','uncommon','rare','mythic') — safe to inline
function buildRarityWhere(rarities) {
  if (!rarities || !rarities.length) return '';
  const vals = rarities.map(r => `'${r}'`).join(',');
  return `AND EXISTS (
    SELECT 1 FROM card_images ci
    WHERE ci.oracle_id = c.oracle_id AND ci.rarity IN (${vals})
  )`;
}

// setCode is user input — strip to alphanumeric before inlining
function buildSetWhere(setCode) {
  if (!setCode || !setCode.trim()) return '';
  const safe = setCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!safe) return '';
  // c.sets is a JSON array of set codes stored by updateCardSets()
  return `AND c.sets LIKE '%"${safe}"%'`;
}

// legality — format name from a fixed list, strip non-alpha to be safe
function buildLegalityWhere(legality) {
  if (!legality) return '';
  const safe = legality.replace(/[^a-z_]/g, '');
  return `AND json_extract(c.legalities, '$.${safe}') = 'legal'`;
}

// game_changer is a Scryfall boolean stored in full_data JSON
function buildGameChangerWhere(gameChanger) {
  if (!gameChanger) return '';
  return `AND json_extract(c.full_data, '$.game_changer') = 1`;
}

// power / toughness — GLOB guards against non-numeric values like '*'
function buildPowerWhere(min, max) {
  const parts = [];
  if (min != null && min !== '') parts.push(`CAST(c.power AS REAL) >= ${Number(min)}`);
  if (max != null && max !== '') parts.push(`CAST(c.power AS REAL) <= ${Number(max)}`);
  return parts.length ? `AND c.power GLOB '[0-9]*' AND ${parts.join(' AND ')}` : '';
}

function buildToughnessWhere(min, max) {
  const parts = [];
  if (min != null && min !== '') parts.push(`CAST(c.toughness AS REAL) >= ${Number(min)}`);
  if (max != null && max !== '') parts.push(`CAST(c.toughness AS REAL) <= ${Number(max)}`);
  return parts.length ? `AND c.toughness GLOB '[0-9]*' AND ${parts.join(' AND ')}` : '';
}

function searchCards(db, {
  q = '', page = 1, pageSize = 20,
  colors = [], searchIn = 'all',
  types = [], cmcMin = null, cmcMax = null, rarities = [],
  setCode = '', legality = '', gameChanger = false,
  powerMin = null, powerMax = null,
  toughnessMin = null, toughnessMax = null,
} = {}) {
  const offset     = (page - 1) * pageSize;
  const ftsQuery   = q ? toFtsQuery(q, searchIn) : null;
  const extraWhere = [
    buildColorWhere(colors),
    buildTypeWhere(types),
    buildCmcWhere(cmcMin, cmcMax),
    buildRarityWhere(rarities),
    buildSetWhere(setCode),
    buildLegalityWhere(legality),
    buildGameChangerWhere(gameChanger),
    buildPowerWhere(powerMin, powerMax),
    buildToughnessWhere(toughnessMin, toughnessMax),
  ].join(' ');

  const hasAnyFilter = ftsQuery || colors.length || types.length ||
    cmcMin != null || cmcMax != null || rarities.length ||
    setCode || legality || gameChanger ||
    powerMin != null || powerMax != null ||
    toughnessMin != null || toughnessMax != null;

  if (!hasAnyFilter) return { cards: [] };

  let rows;
  if (ftsQuery) {
    rows = db.prepare(`
      SELECT c.*
      FROM cards_fts
      JOIN cards c ON c.rowid = cards_fts.rowid
      WHERE cards_fts MATCH ?
      ${extraWhere}
      ORDER BY cards_fts.rank
      LIMIT ? OFFSET ?
    `).all(ftsQuery, pageSize, offset);
  } else {
    rows = db.prepare(`
      SELECT c.*
      FROM cards c
      WHERE 1=1 ${extraWhere}
      ORDER BY c.name ASC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);
  }

  return {
    cards: rows.map(row => Object.assign({}, row, { full_data: fromJson(row.full_data) })),
  };
}

// Called at end of sync to rebuild the FTS index from the cards table.
function rebuildFts(db) {
  db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`);
}

function getCard(db, { oracleId }) {
  const row = db.prepare('SELECT * FROM cards WHERE oracle_id = ?').get(oracleId);
  if (!row) return null;
  return Object.assign({}, row, { full_data: fromJson(row.full_data) });
}

function getCardImages(db, { oracleId }) {
  return db.prepare(
    'SELECT * FROM card_images WHERE oracle_id = ? ORDER BY released_at ASC'
  ).all(oracleId).map(row => Object.assign({}, row, {
    image_uris:    fromJson(row.image_uris),
    card_faces:    fromJson(row.card_faces),
    frame_effects: fromJson(row.frame_effects),
    prices:        fromJson(row.prices),
    purchase_uris: fromJson(row.purchase_uris),
  }));
}

function getCardsBatch(db, { oracleIds }) {
  if (!oracleIds || !oracleIds.length) return [];
  const placeholders = oracleIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM cards WHERE oracle_id IN (${placeholders})`).all(...oracleIds);
  return rows.map(row => Object.assign({}, row, { full_data: fromJson(row.full_data) }));
}

module.exports = {
  initCards,
  getMetadata,
  getCardCount,
  getTokenCount,
  clearAll,
  insertCard,
  insertToken,
  insertCardImage,
  insertTokenImage,
  updateCardSets,
  updateMetadata,
  rebuildFts,
  searchCards,
  getCard,
  getCardImages,
  getCardsBatch,
};
