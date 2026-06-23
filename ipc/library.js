'use strict';

const lib = require('../db/library');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('ipc:library');

function registerLibraryHandlers(ipcMain, getDb) {
  // Wrap every handler: log the channel at DEBUG, and log any errors at ERROR.
  const handle = (channel, fn) => {
    ipcMain.handle(channel, (_e, args) => {
      const t0 = Date.now();
      try {
        const result = fn(getDb(), args);
        log.debug(`${channel} (${Date.now() - t0}ms)`);
        return result;
      } catch (err) {
        log.error(`${channel} FAILED (${Date.now() - t0}ms): ${err.message}`, { args });
        throw err;
      }
    });
  };

  handle('lib:getFolderTree',           lib.getFolderTree);
  handle('lib:createFolder',            lib.createFolder);
  handle('lib:renameFolder',            lib.renameFolder);
  handle('lib:deleteFolder',            lib.deleteFolder);
  handle('lib:moveFolder',              lib.moveFolder);
  handle('lib:getDecks',                lib.getDecks);
  handle('lib:createDeck',              lib.createDeck);
  handle('lib:getDeck',                 lib.getDeck);
  handle('lib:updateDeck',              lib.updateDeck);
  handle('lib:deleteDeck',              lib.deleteDeck);
  handle('lib:moveDeck',                lib.moveDeck);
  handle('lib:duplicateDeck',           lib.duplicateDeck);
  handle('lib:addCardToDeck',           lib.addCardToDeck);
  handle('lib:removeCardFromDeck',      lib.removeCardFromDeck);
  handle('lib:updateCardBoard',         lib.updateCardBoard);
  handle('lib:updateCardQuantity',      lib.updateCardQuantity);
  handle('lib:getRecipients',           lib.getRecipients);
  handle('lib:createRecipient',         lib.createRecipient);
  handle('lib:updateRecipient',         lib.updateRecipient);
  handle('lib:deleteRecipient',         lib.deleteRecipient);
  handle('lib:mountDeck',               lib.mountDeck);
  handle('lib:unmountDeck',             lib.unmountDeck);
  handle('lib:getCollection',           lib.getCollection);
  handle('lib:addToCollection',         lib.addToCollection);
  handle('lib:removeFromCollection',    lib.removeFromCollection);
  handle('lib:updateCollectionEntry',   lib.updateCollectionEntry);
  handle('lib:getDeckCardStatuses',     lib.getDeckCardStatuses);
  handle('lib:updateCardProxy',         lib.updateCardProxy);
  handle('lib:getWishlist',             lib.getWishlist);
  handle('lib:addToWishlist',           lib.addToWishlist);
  handle('lib:removeFromWishlist',      lib.removeFromWishlist);
  handle('lib:updateWishlistEntry',     lib.updateWishlistEntry);
  handle('lib:logActivity',             lib.logActivity);
  handle('lib:getActivityLog',          lib.getActivityLog);
  handle('lib:saveCanvas',              lib.saveCanvas);
  handle('lib:loadCanvas',              lib.loadCanvas);
  handle('lib:getArrangements',         lib.getArrangements);
  handle('lib:createArrangement',       lib.createArrangement);
  handle('lib:renameArrangement',       lib.renameArrangement);
  handle('lib:deleteArrangement',       lib.deleteArrangement);
  handle('lib:saveArrangementCanvas',   lib.saveArrangementCanvas);
  handle('lib:loadArrangementCanvas',   lib.loadArrangementCanvas);
  handle('lib:getDecksWithCard',        lib.getDecksWithCard);
  handle('lib:getMostUsedCards',        lib.getMostUsedCards);

  log.info(`Registered ${44} lib: handlers`);
}

module.exports = { registerLibraryHandlers };
