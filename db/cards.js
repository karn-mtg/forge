'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// karnforge only owns the AI metadata table — the rest of the schema is
// created and maintained by karn-arsenal (prints_builder.py).
const AI_METADATA_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_card_metadata (
    oracle_id      TEXT PRIMARY KEY REFERENCES cards(oracle_id),
    archetype_tags TEXT,
    synergy_pairs  TEXT,
    role_tags      TEXT,
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
`;

/**
 * Opens prints.db created by karn-arsenal. Returns null if the file doesn't
 * exist yet — the caller must handle null gracefully.
 */
function initCards(arsenalDataDir) {
  const dbPath = path.join(arsenalDataDir, 'prints.db');
  if (!require('fs').existsSync(dbPath)) {
    console.log('[cards] prints.db not found — waiting for karn-arsenal to initialise it');
    return null;
  }
  console.log('[cards] Opening arsenal prints.db:', dbPath);
  const db = new Database(dbPath);

  // karnforge-owned table only — karn-arsenal owns the rest
  db.exec(AI_METADATA_SCHEMA);
  try { db.exec('ALTER TABLE ai_card_metadata ADD COLUMN edhrec_inclusion_pct REAL'); } catch {}
  try { db.exec('ALTER TABLE ai_card_metadata ADD COLUMN edhrec_updated_at TEXT'); } catch {}

  return db;
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

// maxPriceUsd — filters by the USD price stored in the cards.prices JSON column
function buildPriceWhere(maxPriceUsd) {
  if (maxPriceUsd == null || maxPriceUsd === '') return '';
  const n = Number(maxPriceUsd);
  if (isNaN(n) || n <= 0) return '';
  return `AND (
    CAST(json_extract(c.prices, '$.usd') AS REAL) <= ${n}
    OR json_extract(c.prices, '$.usd') IS NULL
  )`;
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

function buildKeywordsWhere(keywords) {
  if (!keywords || !keywords.length) return '';
  const clauses = keywords.map(k => `c.keywords LIKE '%"${k.replace(/"/g, '').replace(/'/g, '')}"%'`);
  return `AND (${clauses.join(' AND ')})`;
}

function buildLoyaltyWhere(min, max) {
  const parts = [];
  if (min != null && min !== '') parts.push(`CAST(c.loyalty AS REAL) >= ${Number(min)}`);
  if (max != null && max !== '') parts.push(`CAST(c.loyalty AS REAL) <= ${Number(max)}`);
  return parts.length ? `AND c.loyalty GLOB '[0-9]*' AND ${parts.join(' AND ')}` : '';
}

function buildColorCountWhere(colorCount, colorCountOp) {
  if (colorCount == null || colorCount === '') return '';
  const n = Number(colorCount);
  if (isNaN(n)) return '';
  const len = `json_array_length(c.color_identity)`;
  if (n === 0) return `AND (${len} = 0 OR c.color_identity IS NULL)`;
  if (colorCountOp === 'at-most')  return `AND ${len} <= ${n}`;
  if (colorCountOp === 'at-least') return `AND ${len} >= ${n}`;
  return `AND ${len} = ${n}`;
}

function buildLayoutWhere(layouts) {
  if (!layouts || !layouts.length) return '';
  const SAFE = /^[a-z_]+$/;
  const vals = layouts.filter(l => SAFE.test(l)).map(l => `'${l}'`).join(',');
  return vals ? `AND c.layout IN (${vals})` : '';
}

function buildReservedWhere(reserved) {
  return reserved ? `AND c.reserved = 1` : '';
}

function buildEdhrecRankWhere(edhrecRankMax) {
  if (edhrecRankMax == null || edhrecRankMax === '') return '';
  const n = Number(edhrecRankMax);
  if (isNaN(n) || n <= 0) return '';
  return `AND c.edhrec_rank IS NOT NULL AND c.edhrec_rank <= ${n}`;
}

function buildProducedManaWhere(producedMana) {
  if (!producedMana || !producedMana.length) return '';
  const SAFE = /^[WUBRGC]$/;
  const clauses = producedMana.filter(c => SAFE.test(c)).map(c => `c.produced_mana LIKE '%"${c}"%'`);
  return clauses.length ? `AND (${clauses.join(' OR ')})` : '';
}

function searchCards(db, {
  q = '', page = 1, pageSize = 20,
  colors = [], searchIn = 'all',
  types = [], cmcMin = null, cmcMax = null, rarities = [],
  setCode = '', legality = '', gameChanger = false,
  powerMin = null, powerMax = null,
  toughnessMin = null, toughnessMax = null,
  maxPriceUsd = null,
  keywords = [],
  loyaltyMin = null, loyaltyMax = null,
  colorCount = null, colorCountOp = 'exactly',
  layouts = [],
  reserved = false,
  edhrecRankMax = null,
  producedMana = [],
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
    buildPriceWhere(maxPriceUsd),
    buildKeywordsWhere(keywords),
    buildLoyaltyWhere(loyaltyMin, loyaltyMax),
    buildColorCountWhere(colorCount, colorCountOp),
    buildLayoutWhere(layouts),
    buildReservedWhere(reserved),
    buildEdhrecRankWhere(edhrecRankMax),
    buildProducedManaWhere(producedMana),
  ].join(' ');

  const hasAnyFilter = ftsQuery || colors.length || types.length ||
    cmcMin != null || cmcMax != null || rarities.length ||
    setCode || legality || gameChanger ||
    powerMin != null || powerMax != null ||
    toughnessMin != null || toughnessMax != null ||
    (maxPriceUsd != null && maxPriceUsd !== '') ||
    keywords.length || loyaltyMin != null || loyaltyMax != null ||
    colorCount != null || layouts.length || reserved ||
    edhrecRankMax != null || producedMana.length;

  if (!hasAnyFilter) return { cards: [] };

  // full_data (large Scryfall JSON blob) is excluded from search results — only getCard needs it
  const SEARCH_COLS = `c.oracle_id, c.name, c.type_line, c.oracle_text, c.color_identity,
    c.cmc, c.mana_cost, c.keywords, c.legalities, c.reserved,
    c.image_url, c.released_at, c.sets, c.colors`;

  let rows;
  if (ftsQuery) {
    rows = db.prepare(`
      SELECT ${SEARCH_COLS}
      FROM cards_fts
      JOIN cards c ON c.rowid = cards_fts.rowid
      WHERE cards_fts MATCH ?
      ${extraWhere}
      ORDER BY cards_fts.rank
      LIMIT ? OFFSET ?
    `).all(ftsQuery, pageSize, offset);
  } else {
    rows = db.prepare(`
      SELECT ${SEARCH_COLS}
      FROM cards c
      WHERE 1=1 ${extraWhere}
      ORDER BY c.name ASC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);
  }

  return { cards: rows };
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

function getCardsByNames(db, { names }) {
  if (!names || !names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM cards WHERE name IN (${placeholders})`).all(...names);
  return rows.map(row => Object.assign({}, row, { full_data: fromJson(row.full_data) }));
}

function getCardsByNamesLight(db, { names }) {
  if (!names || !names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  return db.prepare(`SELECT oracle_id, name FROM cards WHERE name IN (${placeholders})`).all(...names);
}

function getRoleTags(db, { oracleIds }) {
  if (!oracleIds || !oracleIds.length) return {};
  const placeholders = oracleIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT oracle_id, role_tags FROM ai_card_metadata WHERE oracle_id IN (${placeholders})`
  ).all(...oracleIds);
  const result = {};
  for (const row of rows) {
    result[row.oracle_id] = row.role_tags ? JSON.parse(row.role_tags) : [];
  }
  return result;
}

function searchByRole(db, { roles = [], pageSize = 60 } = {}) {
  if (!roles || !roles.length) return { cards: [] };
  const conditions = roles.map(() => `m.role_tags LIKE ?`).join(' OR ');
  const params = roles.map(r => `%"${r}"%`);
  const rows = db.prepare(`
    SELECT c.* FROM cards c
    JOIN ai_card_metadata m ON c.oracle_id = m.oracle_id
    WHERE ${conditions}
    ORDER BY c.edhrec_rank ASC NULLS LAST, c.name ASC
    LIMIT ?
  `).all(...params, pageSize);
  return { cards: rows.map(row => Object.assign({}, row, { full_data: fromJson(row.full_data) })) };
}

// ---------------------------------------------------------------------------
// AI Card Metadata
// ---------------------------------------------------------------------------

function getCardMetadata(db, { oracleIds }) {
  if (!oracleIds || !oracleIds.length) return {};
  const placeholders = oracleIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM ai_card_metadata WHERE oracle_id IN (${placeholders})`)
    .all(...oracleIds);
  const map = {};
  for (const row of rows) {
    map[row.oracle_id] = {
      archetype_tags: row.archetype_tags ? JSON.parse(row.archetype_tags) : [],
      role_tags:      row.role_tags      ? JSON.parse(row.role_tags)      : [],
      synergy_pairs:  row.synergy_pairs  ? JSON.parse(row.synergy_pairs)  : [],
    };
  }
  return map;
}

function upsertCardMetadata(db, { oracleId, roleTags, archetypeTags, synergyPairs }) {
  db.prepare(`
    INSERT OR REPLACE INTO ai_card_metadata (oracle_id, role_tags, archetype_tags, synergy_pairs, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).run(
    oracleId,
    roleTags      ? JSON.stringify(roleTags)      : null,
    archetypeTags ? JSON.stringify(archetypeTags) : null,
    synergyPairs  ? JSON.stringify(synergyPairs)  : null,
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// EDHREC Inclusion Cache (persisted in ai_card_metadata)
// ---------------------------------------------------------------------------

const EDHREC_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Returns a map of oracle_id → { pct, updatedAt } for all requested IDs. */
function getCachedEdhrec(db, oracleIds) {
  if (!oracleIds || !oracleIds.length) return {};
  const ph = oracleIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT oracle_id, edhrec_inclusion_pct, edhrec_updated_at
    FROM ai_card_metadata WHERE oracle_id IN (${ph})
  `).all(...oracleIds);
  const map = {};
  for (const r of rows) {
    map[r.oracle_id] = { pct: r.edhrec_inclusion_pct, updatedAt: r.edhrec_updated_at };
  }
  return map;
}

/** Upserts EDHREC inclusion data; never overwrites role_tags or archetype_tags. */
function upsertEdhrecBatch(db, entries) {
  if (!entries || !entries.length) return;
  const stmt = db.prepare(`
    INSERT INTO ai_card_metadata (oracle_id, edhrec_inclusion_pct, edhrec_updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(oracle_id) DO UPDATE SET
      edhrec_inclusion_pct = excluded.edhrec_inclusion_pct,
      edhrec_updated_at    = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `);
  db.transaction((items) => { for (const e of items) stmt.run(e.oracleId, e.pct); })(entries);
}

module.exports = {
  EDHREC_STALE_MS,
  getCachedEdhrec,
  upsertEdhrecBatch,
  initCards,
  getMetadata,
  getCardCount,
  getTokenCount,
  searchCards,
  getCard,
  getCardImages,
  getCardsBatch,
  getCardsByNames,
  getCardsByNamesLight,
  getRoleTags,
  searchByRole,
  getCardMetadata,
  upsertCardMetadata,
};
