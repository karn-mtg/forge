'use strict';

const lib = require('../db/library');

function registerLibraryHandlers(ipcMain, getDb) {
  ipcMain.handle('lib:getFolderTree',      (_e, args) => lib.getFolderTree(getDb(), args));
  ipcMain.handle('lib:createFolder',       (_e, args) => lib.createFolder(getDb(), args));
  ipcMain.handle('lib:renameFolder',       (_e, args) => lib.renameFolder(getDb(), args));
  ipcMain.handle('lib:deleteFolder',       (_e, args) => lib.deleteFolder(getDb(), args));
  ipcMain.handle('lib:getDecks',           (_e, args) => lib.getDecks(getDb(), args));
  ipcMain.handle('lib:createDeck',         (_e, args) => lib.createDeck(getDb(), args));
  ipcMain.handle('lib:getDeck',            (_e, args) => lib.getDeck(getDb(), args));
  ipcMain.handle('lib:updateDeck',         (_e, args) => lib.updateDeck(getDb(), args));
  ipcMain.handle('lib:deleteDeck',         (_e, args) => lib.deleteDeck(getDb(), args));
  ipcMain.handle('lib:moveDeck',           (_e, args) => lib.moveDeck(getDb(), args));
  ipcMain.handle('lib:duplicateDeck',      (_e, args) => lib.duplicateDeck(getDb(), args));
  ipcMain.handle('lib:addCardToDeck',      (_e, args) => lib.addCardToDeck(getDb(), args));
  ipcMain.handle('lib:removeCardFromDeck', (_e, args) => lib.removeCardFromDeck(getDb(), args));
  ipcMain.handle('lib:updateCardBoard',    (_e, args) => lib.updateCardBoard(getDb(), args));
  ipcMain.handle('lib:updateCardQuantity', (_e, args) => lib.updateCardQuantity(getDb(), args));
  ipcMain.handle('lib:getCollection',      (_e, args) => lib.getCollection(getDb(), args));
  ipcMain.handle('lib:addToCollection',    (_e, args) => lib.addToCollection(getDb(), args));
  ipcMain.handle('lib:removeFromCollection', (_e, args) => lib.removeFromCollection(getDb(), args));
  ipcMain.handle('lib:updateCollectionEntry', (_e, args) => lib.updateCollectionEntry(getDb(), args));
  ipcMain.handle('lib:getWishlist',        (_e, args) => lib.getWishlist(getDb(), args));
  ipcMain.handle('lib:addToWishlist',      (_e, args) => lib.addToWishlist(getDb(), args));
  ipcMain.handle('lib:removeFromWishlist', (_e, args) => lib.removeFromWishlist(getDb(), args));
  ipcMain.handle('lib:updateWishlistEntry', (_e, args) => lib.updateWishlistEntry(getDb(), args));
  ipcMain.handle('lib:logActivity',             (_e, args) => lib.logActivity(getDb(), args));
  ipcMain.handle('lib:getActivityLog',          (_e, args) => lib.getActivityLog(getDb(), args));
  ipcMain.handle('lib:saveCanvas',              (_e, args) => lib.saveCanvas(getDb(), args));
  ipcMain.handle('lib:loadCanvas',              (_e, args) => lib.loadCanvas(getDb(), args));
  ipcMain.handle('lib:getArrangements',         (_e, args) => lib.getArrangements(getDb(), args));
  ipcMain.handle('lib:createArrangement',       (_e, args) => lib.createArrangement(getDb(), args));
  ipcMain.handle('lib:renameArrangement',       (_e, args) => lib.renameArrangement(getDb(), args));
  ipcMain.handle('lib:deleteArrangement',       (_e, args) => lib.deleteArrangement(getDb(), args));
  ipcMain.handle('lib:saveArrangementCanvas',   (_e, args) => lib.saveArrangementCanvas(getDb(), args));
  ipcMain.handle('lib:loadArrangementCanvas',   (_e, args) => lib.loadArrangementCanvas(getDb(), args));
}

module.exports = { registerLibraryHandlers };
