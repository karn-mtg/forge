'use strict';

const https = require('https');
const {
  getMetadata, getCardCount, getTokenCount,
  searchCards, getCard, getCardImages, getCardsBatch,
  getCardsByNames, getCardsByNamesLight, getRoleTags, searchByRole,
  getCachedEdhrec, upsertEdhrecBatch, EDHREC_STALE_MS,
} = require('../db/cards');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('ipc:cards');

// ── EDHREC fetch helpers ───────────────────────────────────────────────────────

const EDHREC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** In-memory cache: card name → { pct: number | null, fetchedAt: number } */
const edhrecCache = new Map();

/** In-memory cache: URL → { data: object | null, fetchedAt: number } */
const edhrecPageCache = new Map();

/**
 * Convert a card name to the EDHREC URL slug.
 * e.g. "Atraxa, Praetors' Voice" → "atraxa-praetors-voice"
 */
function toEdhrecSlug(name) {
  return name
    .toLowerCase()
    .replace(/[',\."]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');
}

/**
 * Fetch inclusion % from EDHREC JSON API with in-memory caching.
 * Returns { pct: number } on success, { pct: null } on error or card not found.
 */
function fetchEdhrecInclusion(cardName) {
  const cached = edhrecCache.get(cardName);
  if (cached && (Date.now() - cached.fetchedAt) < EDHREC_CACHE_TTL_MS) {
    log.debug(`fetchEdhrecInclusion cache HIT: ${cardName} → pct=${cached.pct}`);
    return Promise.resolve({ pct: cached.pct });
  }

  log.debug(`fetchEdhrecInclusion fetch: ${cardName}`);
  return new Promise((resolve) => {
    const slug = toEdhrecSlug(cardName);
    const url = `https://json.edhrec.com/cards/${slug}.json`;
    const req = https.get(url, { headers: { 'User-Agent': 'KarnForge/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        log.warn(`fetchEdhrecInclusion HTTP ${res.statusCode}: ${cardName}`);
        edhrecCache.set(cardName, { pct: null, fetchedAt: Date.now() });
        return resolve({ pct: null });
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          // EDHREC JSON API shape: { card: { inclusion: N, potential_decks: N, ... } }
          const inclusion = json?.card?.inclusion;
          const potential = json?.card?.potential_decks;
          const pct = (typeof inclusion === 'number' && typeof potential === 'number' && potential > 0)
            ? Math.round((inclusion / potential) * 1000) / 10  // one decimal
            : null;
          edhrecCache.set(cardName, { pct, fetchedAt: Date.now() });
          log.debug(`fetchEdhrecInclusion result: ${cardName} → pct=${pct}`);
          resolve({ pct });
        } catch {
          log.warn(`fetchEdhrecInclusion parse error: ${cardName}`);
          edhrecCache.set(cardName, { pct: null, fetchedAt: Date.now() });
          resolve({ pct: null });
        }
      });
      res.on('error', (e) => { log.warn(`fetchEdhrecInclusion response error: ${e.message}`); resolve({ pct: null }); });
    });
    req.on('error', (e) => { log.warn(`fetchEdhrecInclusion request error: ${e.message}`); resolve({ pct: null }); });
    req.setTimeout(8000, () => { log.warn(`fetchEdhrecInclusion timeout: ${cardName}`); req.destroy(); resolve({ pct: null }); });
  });
}

// ── EDHREC page fetch (commander/theme pages) ──────────────────────────────────

function fetchEdhrecPage(url) {
  const cached = edhrecPageCache.get(url);
  if (cached && (Date.now() - cached.fetchedAt) < EDHREC_CACHE_TTL_MS) {
    log.debug(`fetchEdhrecPage cache HIT: ${url}`);
    return Promise.resolve(cached.data);
  }
  log.debug(`fetchEdhrecPage fetch: ${url}`);
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'KarnForge/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        log.warn(`fetchEdhrecPage HTTP ${res.statusCode}: ${url}`);
        edhrecPageCache.set(url, { data: null, fetchedAt: Date.now() });
        return resolve(null);
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          edhrecPageCache.set(url, { data: json, fetchedAt: Date.now() });
          log.debug(`fetchEdhrecPage OK: ${url}`);
          resolve(json);
        } catch {
          log.warn(`fetchEdhrecPage parse error: ${url}`);
          edhrecPageCache.set(url, { data: null, fetchedAt: Date.now() });
          resolve(null);
        }
      });
      res.on('error', (e) => { log.warn(`fetchEdhrecPage response error: ${e.message}`); resolve(null); });
    });
    req.on('error', (e) => { log.warn(`fetchEdhrecPage request error: ${e.message}`); resolve(null); });
    req.setTimeout(12000, () => { log.warn(`fetchEdhrecPage timeout: ${url}`); req.destroy(); resolve(null); });
  });
}

function parseEdhrecCardlists(data) {
  if (!data) return { numDecks: 0, cards: [] };

  // Handle both top-level and container.json_dict layouts
  const root = data.container?.json_dict ?? data;
  const cardlists = root.cardlists ?? [];
  const numDecks = root.header?.num_decks ?? root.numDecks ?? 0;

  const cards = [];
  const seen = new Set();

  for (const list of cardlists) {
    const section = list.tag || list.label || '';
    if (/similar.*commander|new card/i.test(section)) continue;

    for (const cv of (list.cardviews || [])) {
      const name = cv.name || cv.label || (Array.isArray(cv.names) ? cv.names[0] : null);
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const inclusion = cv.inclusion ?? cv.num_decks ?? 0;
      const potential = cv.potential_decks ?? numDecks ?? 1;
      const pct = potential > 0 ? Math.round((inclusion / potential) * 1000) / 10 : null;

      cards.push({
        name,
        pct,
        synergy: typeof cv.synergy === 'number' ? Math.round(cv.synergy * 1000) / 10 : null,
        section,
      });
    }
  }

  cards.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  return { numDecks, cards };
}

async function fetchEdhrecCommander(commanderName) {
  const slug = toEdhrecSlug(commanderName);
  const data = await fetchEdhrecPage(`https://json.edhrec.com/pages/commanders/${slug}.json`);
  return parseEdhrecCardlists(data);
}

async function fetchEdhrecTheme(theme) {
  const slug = toEdhrecSlug(theme);
  const data = await fetchEdhrecPage(`https://json.edhrec.com/pages/themes/${slug}.json`);
  return parseEdhrecCardlists(data);
}

// ── Commander Spellbook combo detection ───────────────────────────────────────

const spellbookCache = new Map(); // key: sorted cardNames join, value: { data, fetchedAt }
const SPELLBOOK_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function fetchSpellbookCombos(cardNames) {
  const key = [...cardNames].sort().join('\0');
  const cached = spellbookCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < SPELLBOOK_TTL_MS) {
    log.debug(`fetchSpellbookCombos cache HIT: ${cardNames.length} cards → ${cached.data.length} combos`);
    return Promise.resolve(cached.data);
  }
  log.debug(`fetchSpellbookCombos fetch: ${cardNames.length} cards`);
  // Build query: ?cards[]=Name1&cards[]=Name2...
  const params = cardNames.map(n => `cards[]=${encodeURIComponent(n)}`).join('&');
  const path = `/api/v2/variants/?${params}&limit=20`;
  return new Promise(resolve => {
    const req = https.get({ hostname: 'backend.commanderspellbook.com', path, headers: { 'User-Agent': 'KarnForge/1.0' } }, res => {
      if (res.statusCode !== 200) { spellbookCache.set(key, { data: [], fetchedAt: Date.now() }); return resolve([]); }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          const combos = (json.results || []).map(v => ({
            id: v.id,
            cards: (v.uses || []).map(u => u.card?.name).filter(Boolean),
            results: (v.produces || []).map(p => p.feature?.name).filter(Boolean),
            description: v.description || '',
            identity: v.identity || '',
          }));
          spellbookCache.set(key, { data: combos, fetchedAt: Date.now() });
          log.debug(`fetchSpellbookCombos result: ${combos.length} combos`);
          resolve(combos);
        } catch { spellbookCache.set(key, { data: [], fetchedAt: Date.now() }); resolve([]); }
      });
      res.on('error', () => resolve([]));
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

function registerCardsHandlers(ipcMain, getDb, getWindow) {
  ipcMain.handle('cards:status', () => {
    const db = getDb();
    if (!db) {
      log.warn('cards:status — DB not available');
      return { cardCount: 0, tokenCount: 0, ready: false };
    }
    const meta = getMetadata(db);
    const cardCount = getCardCount(db);
    const tokenCount = getTokenCount(db);
    log.debug('cards:status', { cardCount, tokenCount, last_updated_at: meta?.last_updated_at });
    return { ...meta, cardCount, tokenCount, ready: true };
  });

  ipcMain.handle('cards:search', (_, args) => {
    const db = getDb();
    if (!db) { log.warn('cards:search — DB not available'); return { cards: [] }; }
    const t0 = Date.now();
    const result = searchCards(db, args);
    log.debug(`cards:search q="${args?.q ?? ''}" → ${result.cards?.length ?? 0} results (${Date.now() - t0}ms)`);
    return result;
  });

  ipcMain.handle('cards:getCard', (_, args) => {
    const db = getDb();
    if (!db) return null;
    const result = getCard(db, args);
    log.debug(`cards:getCard ${args?.oracleId} → ${result ? result.name : 'null'}`);
    return result;
  });

  ipcMain.handle('cards:getCardImages', (_, args) => {
    const db = getDb();
    if (!db) return [];
    const result = getCardImages(db, args);
    log.debug(`cards:getCardImages ${args?.oracleId} → ${result?.length ?? 0} images`);
    return result;
  });

  ipcMain.handle('cards:getCardsBatch', (_, args) => {
    const db = getDb();
    if (!db) return [];
    const t0 = Date.now();
    const result = getCardsBatch(db, args);
    log.debug(`cards:getCardsBatch ${args?.oracleIds?.length ?? 0} ids → ${result?.length ?? 0} cards (${Date.now() - t0}ms)`);
    return result;
  });

  ipcMain.handle('cards:getCardsByNames',      (_, args) => { const db = getDb(); return db ? getCardsByNames(db, args) : []; });
  ipcMain.handle('cards:getCardsByNamesLight', (_, args) => { const db = getDb(); return db ? getCardsByNamesLight(db, args) : []; });
  ipcMain.handle('cards:getRoleTags',         (_, args) => { const db = getDb(); return db ? getRoleTags(db, args) : {}; });
  ipcMain.handle('cards:searchByRole', (_, args) => {
    const db = getDb();
    if (!db) return { cards: [] };
    const result = searchByRole(db, args);
    log.debug(`cards:searchByRole roles=[${args?.roles?.join(',')}] → ${result.cards?.length ?? 0} cards`);
    return result;
  });

  ipcMain.handle('cards:fetchEdhrecData', async (_, { cardName }) => {
    // L1: in-memory cache (keyed by name, survives within session)
    const memCached = edhrecCache.get(cardName);
    if (memCached && (Date.now() - memCached.fetchedAt) < EDHREC_CACHE_TTL_MS) {
      return { pct: memCached.pct };
    }
    // L2: SQLite persistent cache (keyed by oracle_id, survives restarts)
    const db = getDb();
    let oracleId = null;
    if (db) {
      const cardRow = db.prepare('SELECT oracle_id FROM cards WHERE name = ? LIMIT 1').get(cardName);
      oracleId = cardRow?.oracle_id ?? null;
      if (oracleId) {
        const sqlCache = getCachedEdhrec(db, [oracleId]);
        const entry = sqlCache[oracleId];
        if (entry && (Date.now() - new Date(entry.updatedAt).getTime()) < EDHREC_STALE_MS) {
          edhrecCache.set(cardName, { pct: entry.pct, fetchedAt: Date.now() });
          return { pct: entry.pct };
        }
      }
    }
    // Cache miss — fetch from EDHREC and persist to both layers
    const result = await fetchEdhrecInclusion(cardName);
    if (db && oracleId) {
      upsertEdhrecBatch(db, [{ oracleId, pct: result.pct }]);
    }
    return result;
  });
  ipcMain.handle('cards:fetchEdhrecCommander', (_, { commanderName }) => {
    log.info(`cards:fetchEdhrecCommander: ${commanderName}`);
    return fetchEdhrecCommander(commanderName);
  });
  ipcMain.handle('cards:fetchEdhrecTheme', (_, { theme }) => {
    log.info(`cards:fetchEdhrecTheme: ${theme}`);
    return fetchEdhrecTheme(theme);
  });
  ipcMain.handle('cards:fetchSpellbookCombos', (_, { cardNames }) => fetchSpellbookCombos(cardNames));

  log.info('Registered cards: handlers');
}

module.exports = { registerCardsHandlers, fetchEdhrecInclusion, fetchEdhrecCommander, fetchSpellbookCombos };
