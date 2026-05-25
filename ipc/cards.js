'use strict';

const https = require('https');
const { syncCards } = require('../db/sync');
const { getMetadata, getCardCount, getTokenCount, searchCards, getCard, getCardImages, getCardsBatch } = require('../db/cards');

// ── EDHREC fetch helpers ───────────────────────────────────────────────────────

/** In-memory cache: card name → { pct: number | null, fetchedAt: number } */
const edhrecCache = new Map();
const EDHREC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
    return Promise.resolve({ pct: cached.pct });
  }

  return new Promise((resolve) => {
    const slug = toEdhrecSlug(cardName);
    const url = `https://json.edhrec.com/cards/${slug}.json`;
    const req = https.get(url, { headers: { 'User-Agent': 'KarnForge/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
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
          resolve({ pct });
        } catch {
          edhrecCache.set(cardName, { pct: null, fetchedAt: Date.now() });
          resolve({ pct: null });
        }
      });
      res.on('error', () => { resolve({ pct: null }); });
    });
    req.on('error', () => { resolve({ pct: null }); });
    req.setTimeout(8000, () => { req.destroy(); resolve({ pct: null }); });
  });
}

function registerCardsHandlers(ipcMain, getDb, getWindow) {
  ipcMain.handle('cards:status', () => {
    const db = getDb();
    const meta = getMetadata(db);
    const cardCount = getCardCount(db);
    const tokenCount = getTokenCount(db);
    return { ...meta, cardCount, tokenCount };
  });

  ipcMain.on('cards:startSync', (_event, { refresh = false } = {}) => {
    const db = getDb();
    const onProgress = (data) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('cards:progress', data);
    };
    syncCards(db, { refresh, onProgress }).catch(err => {
      console.error('[cards:startSync] sync failed:', err.message);
    });
  });

  // Fix #2: colors array is forwarded to searchCards for server-side filtering
  ipcMain.handle('cards:search',       (_, args) => searchCards(getDb(), args));
  ipcMain.handle('cards:getCard',      (_, args) => getCard(getDb(), args));
  ipcMain.handle('cards:getCardImages',(_, args) => getCardImages(getDb(), args));
  ipcMain.handle('cards:getCardsBatch',  (_, args) => getCardsBatch(getDb(), args));
  ipcMain.handle('cards:fetchEdhrecData', (_, { cardName }) => fetchEdhrecInclusion(cardName));
}

module.exports = { registerCardsHandlers };
