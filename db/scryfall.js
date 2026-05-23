'use strict';

/**
 * db/scryfall.js
 * SQLite database layer for Scryfall card data.
 * Uses better-sqlite3 (synchronous API, Electron-safe).
 */

const path = require('path');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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
    scryfall_updated_at TEXT,
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
`;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Open (or create) cards.db inside userDataPath, run the schema, and return
 * the better-sqlite3 Database instance.
 *
 * @param {string} userDataPath  Electron's app.getPath('userData')
 * @returns {import('better-sqlite3').Database}
 */
function initScryfall(userDataPath) {
  const dbPath = path.join(userDataPath, 'cards.db');
  const db = new Database(dbPath);

  // WAL + synchronous=NORMAL are set inside the SCHEMA pragma statements,
  // but better-sqlite3 executes pragma via exec so we run the schema directly.
  db.exec(SCHEMA);

  return db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialize a value to JSON string, or null if falsy. */
function toJson(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

/** Parse a JSON string column back to a JS value, or return null. */
function fromJson(str) {
  if (str == null) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Return the single metadata row, or null if absent.
 * @param {import('better-sqlite3').Database} db
 */
function getMetadata(db) {
  return db.prepare('SELECT * FROM metadata WHERE id = 1').get() || null;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
function getCardCount(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM cards').get();
  return row ? row.n : 0;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
function getTokenCount(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM tokens').get();
  return row ? row.n : 0;
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

/**
 * Delete all cards, tokens, and images (but keep metadata).
 * @param {import('better-sqlite3').Database} db
 */
function clearAll(db) {
  db.exec(`
    DELETE FROM token_images;
    DELETE FROM card_images;
    DELETE FROM tokens;
    DELETE FROM cards;
  `);
}

// ---------------------------------------------------------------------------
// Insert: cards
// ---------------------------------------------------------------------------

/**
 * INSERT OR IGNORE a canonical card row (first printing wins for oracle_id).
 * @param {import('better-sqlite3').Database} db
 * @param {object} card  Raw Scryfall card object
 */
function insertCard(db, card) {
  const stmt = db.prepare(`
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
  `);

  stmt.run({
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

// ---------------------------------------------------------------------------
// Insert: tokens
// ---------------------------------------------------------------------------

/**
 * INSERT OR IGNORE a token row.
 * @param {import('better-sqlite3').Database} db
 * @param {object} card  Raw Scryfall card object with layout=token
 */
function insertToken(db, card) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tokens (
      id, oracle_id, name, layout, type_line, oracle_text,
      power, toughness, colors, color_identity,
      keywords, all_parts, full_data
    ) VALUES (
      @id, @oracle_id, @name, @layout, @type_line, @oracle_text,
      @power, @toughness, @colors, @color_identity,
      @keywords, @all_parts, @full_data
    )
  `);

  stmt.run({
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

// ---------------------------------------------------------------------------
// Insert: card_images
// ---------------------------------------------------------------------------

/**
 * INSERT OR IGNORE a printing row into card_images.
 * @param {import('better-sqlite3').Database} db
 * @param {object} card  Raw Scryfall card object
 */
function insertCardImage(db, card) {
  const stmt = db.prepare(`
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
  `);

  stmt.run({
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

// ---------------------------------------------------------------------------
// Insert: token_images
// ---------------------------------------------------------------------------

/**
 * INSERT OR IGNORE a token printing row.
 * @param {import('better-sqlite3').Database} db
 * @param {object} card  Raw Scryfall token object
 */
function insertTokenImage(db, card) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO token_images (
      id, token_oracle_id, set_code, set_name,
      released_at, collector_number, artist,
      image_uris, card_faces
    ) VALUES (
      @id, @token_oracle_id, @set_code, @set_name,
      @released_at, @collector_number, @artist,
      @image_uris, @card_faces
    )
  `);

  stmt.run({
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

// ---------------------------------------------------------------------------
// Post-insert aggregation
// ---------------------------------------------------------------------------

/**
 * Populate cards.sets with a JSON array of distinct set_codes from card_images.
 * Should be called once after all inserts are done.
 * @param {import('better-sqlite3').Database} db
 */
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

// ---------------------------------------------------------------------------
// Metadata upsert
// ---------------------------------------------------------------------------

/**
 * Upsert the single metadata row.
 * @param {import('better-sqlite3').Database} db
 * @param {{ scryfallUpdatedAt: string, fileSize: number, cardCount: number, tokenCount: number }} opts
 */
function updateMetadata(db, { scryfallUpdatedAt, fileSize, cardCount, tokenCount }) {
  db.prepare(`
    INSERT INTO metadata (id, last_updated_at, scryfall_updated_at, file_size, card_count, token_count)
    VALUES (1, @now, @scryfallUpdatedAt, @fileSize, @cardCount, @tokenCount)
    ON CONFLICT(id) DO UPDATE SET
      last_updated_at     = excluded.last_updated_at,
      scryfall_updated_at = excluded.scryfall_updated_at,
      file_size           = excluded.file_size,
      card_count          = excluded.card_count,
      token_count         = excluded.token_count
  `).run({
    now:               new Date().toISOString(),
    scryfallUpdatedAt: scryfallUpdatedAt || null,
    fileSize:          fileSize || 0,
    cardCount:         cardCount || 0,
    tokenCount:        tokenCount || 0,
  });
}

// ---------------------------------------------------------------------------
// Search & query
// ---------------------------------------------------------------------------

/**
 * Full-text-like search across name, type_line, and oracle_text using LIKE.
 * Returns { cards: Array, total: number }.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ q: string, page?: number, pageSize?: number }} opts
 */
function searchCards(db, { q, page = 1, pageSize = 20 }) {
  const pattern = `%${q || ''}%`;
  const offset = (page - 1) * pageSize;

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM cards
    WHERE name LIKE @pattern
       OR type_line LIKE @pattern
       OR oracle_text LIKE @pattern
  `).get({ pattern }).n;

  const rows = db.prepare(`
    SELECT * FROM cards
    WHERE name LIKE @pattern
       OR type_line LIKE @pattern
       OR oracle_text LIKE @pattern
    ORDER BY name ASC
    LIMIT @pageSize OFFSET @offset
  `).all({ pattern, pageSize, offset });

  // Parse full_data back to object for convenience
  const cards = rows.map((row) => {
    const data = fromJson(row.full_data);
    return Object.assign({}, row, { full_data: data });
  });

  return { cards, total };
}

/**
 * Fetch a single card by oracle_id. Returns the row with full_data parsed,
 * or null if not found.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ oracleId: string }} opts
 */
function getCard(db, { oracleId }) {
  const row = db.prepare('SELECT * FROM cards WHERE oracle_id = ?').get(oracleId);
  if (!row) return null;
  return Object.assign({}, row, { full_data: fromJson(row.full_data) });
}

/**
 * Fetch all printings for a given oracle_id, with JSON columns parsed.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ oracleId: string }} opts
 */
function getCardImages(db, { oracleId }) {
  const rows = db.prepare(
    'SELECT * FROM card_images WHERE oracle_id = ? ORDER BY released_at ASC'
  ).all(oracleId);

  return rows.map((row) => Object.assign({}, row, {
    image_uris:    fromJson(row.image_uris),
    card_faces:    fromJson(row.card_faces),
    frame_effects: fromJson(row.frame_effects),
    prices:        fromJson(row.prices),
    purchase_uris: fromJson(row.purchase_uris),
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  initScryfall,
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
  searchCards,
  getCard,
  getCardImages,
};
