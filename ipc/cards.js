'use strict';

const { syncCards } = require('../db/sync');
const { getMetadata, getCardCount, getTokenCount, searchCards, getCard, getCardImages, getCardsBatch } = require('../db/cards');

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
}

module.exports = { registerCardsHandlers };
