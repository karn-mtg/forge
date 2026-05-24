'use strict';

/**
 * db/sync.js
 * Scryfall bulk-data sync orchestrator.
 *
 * Exports:
 *   syncScryfall(db, { refresh, onProgress })
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const StreamJsonParser = require('stream-json');
const StreamArray = require('stream-json/streamers/StreamArray');

const {
  clearAll,
  insertCard,
  insertToken,
  insertCardImage,
  insertTokenImage,
  updateCardSets,
  updateMetadata,
  rebuildFts,
  getMetadata,
} = require('./cards');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRYFALL_BULK_API = 'https://api.scryfall.com/bulk-data/default_cards';
const TEMP_FILE = path.join(os.tmpdir(), 'karnforge_bulk.json');
const BATCH_SIZE = 1000;

// Jumpstart set codes treated as "cover card" sources
const JUMPSTART_SETS = new Set(['jmp', 'j22', 'jmp22', 'j21', 'jmp21', 'j20', 'jmp20']);

// ---------------------------------------------------------------------------
// Filter functions (ported exactly from Python reference)
// ---------------------------------------------------------------------------

/**
 * True if the card is a token (layout === 'token' OR type_line contains 'token').
 * @param {object} card
 */
function isToken(card) {
  const layout = (card.layout || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  return layout === 'token' || typeLine.includes('token');
}

/**
 * True for Jumpstart cover cards: in a JMP set, no mana cost, and very short oracle text.
 * @param {object} card
 */
function isCoverCard(card) {
  if (!JUMPSTART_SETS.has((card.set || '').toLowerCase())) return false;
  const manaCost = card.mana_cost || '';
  const oracleText = card.oracle_text || '';
  return !manaCost && (!oracleText || oracleText.trim().length < 20);
}

/**
 * True if the card belongs to a memorabilia set.
 * @param {object} card
 */
function isMemorabilia(card) {
  return (card.set_type || '').toLowerCase() === 'memorabilia';
}

/**
 * True if the card is an Alchemy card (set_type === 'alchemy' or name starts with 'A-').
 * @param {object} card
 */
function isAlchemy(card) {
  if ((card.set_type || '').toLowerCase() === 'alchemy') return true;
  return (card.name || '').startsWith('A-');
}

/**
 * True if the card is a marker card (type_line exactly equals 'card', case-insensitive).
 * @param {object} card
 */
function isMarkerCard(card) {
  return (card.type_line || '').trim().toLowerCase() === 'card';
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return the parsed JSON body.
 * Follows 301/302 redirects automatically.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    const headers = {
      'User-Agent': 'KarnForge/1.0 (guilherme.albino.francisco@gmail.com)',
      'Accept': 'application/json',
    };
    get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchJson(res.headers.location));
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          // Try to surface the Scryfall error body for easier debugging
          let detail = '';
          try {
            const body = JSON.parse(raw);
            if (body && body.details) detail = ` — ${body.details}`;
          } catch { /* ignore */ }
          return reject(new Error(`HTTP ${res.statusCode} fetching ${url}${detail}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Download a URL to destPath, reporting byte progress via onBytes(received, total).
 * Handles HTTP 301/302 redirects and gzip content-encoding.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {(received: number, total: number) => void} onBytes
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, onBytes) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { headers: { 'User-Agent': 'KarnForge/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(downloadFile(res.headers.location, destPath, onBytes));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;

      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        onBytes(received, total);
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Stream-parse and store
// ---------------------------------------------------------------------------

/**
 * Determine whether the file at filePath starts with gzip magic bytes.
 * @param {string} filePath
 * @returns {boolean}
 */
function isGzip(filePath) {
  const buf = Buffer.alloc(2);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  return buf[0] === 0x1f && buf[1] === 0x8b;
}

/**
 * Stream-parse the bulk JSON file and insert cards/tokens into the database.
 * Reports progress via onProgress every BATCH_SIZE cards.
 * Commits in transactions of BATCH_SIZE rows.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} filePath
 * @param {(data: object) => void} onProgress
 * @returns {Promise<{ cardCount: number, tokenCount: number }>}
 */
function parseAndStore(db, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const stats = {
      cards: 0,
      tokens: 0,
      filteredCover: 0,
      filteredMemo: 0,
      filteredAlchemy: 0,
      filteredMarker: 0,
      errors: 0,
    };

    // Accumulate a batch then commit as a transaction
    let batch = [];

    const commitBatch = db.transaction((items) => {
      for (const item of items) {
        if (item.type === 'card') {
          insertCard(db, item.data);
          insertCardImage(db, item.data);
        } else if (item.type === 'token') {
          insertToken(db, item.data);
          insertTokenImage(db, item.data);
        }
      }
    });

    const flushBatch = () => {
      if (batch.length > 0) {
        commitBatch(batch);
        batch = [];
      }
    };

    // Build the read stream, optionally decompressing
    let rawStream;
    try {
      rawStream = fs.createReadStream(filePath);
      if (isGzip(filePath)) {
        const gunzip = zlib.createGunzip();
        rawStream = rawStream.pipe(gunzip);
      }
    } catch (e) {
      return reject(e);
    }

    const parser = StreamJsonParser.parser();
    const streamArray = StreamArray.streamArray();

    rawStream.on('error', reject);
    parser.on('error', reject);
    streamArray.on('error', reject);

    streamArray.on('data', ({ value: card }) => {
      try {
        if (!card || !card.id) {
          stats.errors++;
          return;
        }

        // Tokens go to their own table — never dropped entirely
        if (isToken(card)) {
          batch.push({ type: 'token', data: card });
          stats.tokens++;

          if (batch.length >= BATCH_SIZE) {
            flushBatch();
            const processed = stats.cards + stats.tokens;
            onProgress({
              phase: 'storing',
              current: processed,
              total: 0,
              message: `Stored ${stats.cards.toLocaleString()} cards, ${stats.tokens.toLocaleString()} tokens…`,
            });
          }
          return;
        }

        // Drop other non-playable cards
        if (isCoverCard(card)) { stats.filteredCover++; return; }
        if (isMemorabilia(card)) { stats.filteredMemo++; return; }
        if (isAlchemy(card)) { stats.filteredAlchemy++; return; }
        if (isMarkerCard(card)) { stats.filteredMarker++; return; }

        // Playable card
        batch.push({ type: 'card', data: card });
        stats.cards++;

        if (batch.length >= BATCH_SIZE) {
          flushBatch();
          const processed = stats.cards + stats.tokens;
          onProgress({
            phase: 'storing',
            current: processed,
            total: 0,
            message: `Stored ${stats.cards.toLocaleString()} cards, ${stats.tokens.toLocaleString()} tokens…`,
          });
        }
      } catch (e) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.warn('[sync] Error processing card:', e.message);
        }
      }
    });

    streamArray.on('end', () => {
      try {
        flushBatch();
        resolve({ cardCount: stats.cards, tokenCount: stats.tokens });
      } catch (e) {
        reject(e);
      }
    });

    rawStream.pipe(parser).pipe(streamArray);
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Orchestrate a full Scryfall bulk-data sync.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ refresh?: boolean, onProgress?: (data: object) => void }} opts
 */
async function syncCards(db, { refresh = false, onProgress = () => {} } = {}) {
  try {
    // ------------------------------------------------------------------
    // Phase: checking
    // ------------------------------------------------------------------
    onProgress({ phase: 'checking', current: 0, total: 0, message: 'Fetching Scryfall metadata…' });

    let bulkMeta;
    try {
      bulkMeta = await fetchJson(SCRYFALL_BULK_API);
    } catch (e) {
      throw new Error(`Could not reach Scryfall API: ${e.message}`);
    }

    const downloadUri = bulkMeta.download_uri;
    const scryfallUpdatedAt = bulkMeta.updated_at || null;
    const fileSize = bulkMeta.size || 0;

    if (!downloadUri) {
      throw new Error('Scryfall bulk metadata contained no download_uri');
    }

    // ------------------------------------------------------------------
    // Smart update: skip if DB is already current
    // ------------------------------------------------------------------
    if (!refresh) {
      const meta = getMetadata(db);
      if (
        meta &&
        meta.card_count > 0 &&
        meta.source_updated_at &&
        meta.source_updated_at >= scryfallUpdatedAt
      ) {
        onProgress({
          phase: 'done',
          current: meta.card_count,
          total: meta.card_count,
          message: `Already up to date (${meta.card_count.toLocaleString()} cards, updated ${meta.scryfall_updated_at})`,
        });
        return;
      }
    }

    // ------------------------------------------------------------------
    // Phase: downloading
    // ------------------------------------------------------------------
    onProgress({
      phase: 'downloading',
      current: 0,
      total: fileSize,
      message: `Downloading bulk data (${(fileSize / 1024 / 1024).toFixed(1)} MB)…`,
    });

    await downloadFile(downloadUri, TEMP_FILE, (received, total) => {
      onProgress({
        phase: 'downloading',
        current: received,
        total: total || fileSize,
        message: `Downloading… ${(received / 1024 / 1024).toFixed(1)} MB`,
      });
    });

    // ------------------------------------------------------------------
    // Phase: parsing + storing
    // ------------------------------------------------------------------
    onProgress({ phase: 'parsing', current: 0, total: 0, message: 'Parsing bulk data…' });

    // Wipe existing data before inserting fresh set
    clearAll(db);

    const { cardCount, tokenCount } = await parseAndStore(db, TEMP_FILE, onProgress);

    // ------------------------------------------------------------------
    // Phase: indexing
    // ------------------------------------------------------------------
    onProgress({ phase: 'indexing', current: 0, total: 0, message: 'Building set & search index…' });

    updateCardSets(db);
    updateMetadata(db, { sourceUpdatedAt: scryfallUpdatedAt, fileSize, cardCount, tokenCount });

    // Fix #1: rebuild FTS index after all cards are committed
    rebuildFts(db);

    // Clean up temp file
    try { fs.unlinkSync(TEMP_FILE); } catch { /* ignore */ }

    // ------------------------------------------------------------------
    // Phase: done
    // ------------------------------------------------------------------
    onProgress({
      phase: 'done',
      current: cardCount,
      total: cardCount,
      message: `Sync complete — ${cardCount.toLocaleString()} cards, ${tokenCount.toLocaleString()} tokens`,
    });
  } catch (err) {
    // Clean up temp file on error
    try { fs.unlinkSync(TEMP_FILE); } catch { /* ignore */ }

    onProgress({ phase: 'error', current: 0, total: 0, message: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  syncCards,
  isToken,
  isCoverCard,
  isMemorabilia,
  isAlchemy,
  isMarkerCard,
};
