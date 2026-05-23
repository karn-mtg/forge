'use strict';

/**
 * ipc/scryfall.js
 * Registers Electron IPC handlers for Scryfall card data.
 *
 * Usage in main.js:
 *   const { registerScryfallHandlers } = require('./ipc/scryfall');
 *   registerScryfallHandlers(ipcMain, () => db, () => mainWindow);
 */

const { syncScryfall } = require('../db/sync');
const {
  getMetadata,
  getCardCount,
  getTokenCount,
  searchCards,
  getCard,
  getCardImages,
} = require('../db/scryfall');

/**
 * Register all Scryfall-related IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {() => import('better-sqlite3').Database} getDb  Getter for the open DB instance
 * @param {() => Electron.BrowserWindow} getWindow         Getter for the main window
 */
function registerScryfallHandlers(ipcMain, getDb, getWindow) {
  // --------------------------------------------------------------------
  // scryfall:status
  // Returns current DB metadata plus live card/token counts.
  // --------------------------------------------------------------------
  ipcMain.handle('scryfall:status', () => {
    const db = getDb();
    const meta = getMetadata(db);
    const cardCount = getCardCount(db);
    const tokenCount = getTokenCount(db);
    return { ...meta, cardCount, tokenCount };
  });

  // --------------------------------------------------------------------
  // scryfall:startSync
  // Fire-and-forget: starts the sync in the background, streams progress
  // events back to the renderer via webContents.send.
  // --------------------------------------------------------------------
  ipcMain.on('scryfall:startSync', (event, { refresh = false } = {}) => {
    const db = getDb();

    const onProgress = (data) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('scryfall:progress', data);
      }
    };

    syncScryfall(db, { refresh, onProgress }).catch((err) => {
      // Error is already sent via onProgress({ phase: 'error', ... }) inside
      // syncScryfall, but log it on the main-process side too.
      console.error('[scryfall:startSync] sync failed:', err.message);
    });
    // Intentionally NOT awaiting — handler returns immediately.
  });

  // --------------------------------------------------------------------
  // scryfall:search
  // Paginated card search across name, type_line, oracle_text.
  // --------------------------------------------------------------------
  ipcMain.handle('scryfall:search', (_, args) => {
    const db = getDb();
    return searchCards(db, args);
  });

  // --------------------------------------------------------------------
  // scryfall:getCard
  // Fetch a single card by oracle_id.
  // --------------------------------------------------------------------
  ipcMain.handle('scryfall:getCard', (_, args) => {
    const db = getDb();
    return getCard(db, args);
  });

  // --------------------------------------------------------------------
  // scryfall:getCardImages
  // Fetch all printings (card_images rows) for a given oracle_id.
  // --------------------------------------------------------------------
  ipcMain.handle('scryfall:getCardImages', (_, args) => {
    const db = getDb();
    return getCardImages(db, args);
  });
}

module.exports = { registerScryfallHandlers };
