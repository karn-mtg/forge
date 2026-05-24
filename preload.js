const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow:    () => ipcRenderer.send('window-close'),
});

contextBridge.exposeInMainWorld('libraryAPI', {
  getFolderTree:        (args) => ipcRenderer.invoke('lib:getFolderTree', args),
  createFolder:         (args) => ipcRenderer.invoke('lib:createFolder', args),
  renameFolder:         (args) => ipcRenderer.invoke('lib:renameFolder', args),
  deleteFolder:         (args) => ipcRenderer.invoke('lib:deleteFolder', args),
  getDecks:             (args) => ipcRenderer.invoke('lib:getDecks', args),
  createDeck:           (args) => ipcRenderer.invoke('lib:createDeck', args),
  getDeck:              (args) => ipcRenderer.invoke('lib:getDeck', args),
  updateDeck:           (args) => ipcRenderer.invoke('lib:updateDeck', args),
  deleteDeck:           (args) => ipcRenderer.invoke('lib:deleteDeck', args),
  moveDeck:             (args) => ipcRenderer.invoke('lib:moveDeck', args),
  duplicateDeck:        (args) => ipcRenderer.invoke('lib:duplicateDeck', args),
  addCardToDeck:        (args) => ipcRenderer.invoke('lib:addCardToDeck', args),
  removeCardFromDeck:   (args) => ipcRenderer.invoke('lib:removeCardFromDeck', args),
  updateCardBoard:      (args) => ipcRenderer.invoke('lib:updateCardBoard', args),
  updateCardQuantity:   (args) => ipcRenderer.invoke('lib:updateCardQuantity', args),
  getCollection:        (args) => ipcRenderer.invoke('lib:getCollection', args),
  addToCollection:      (args) => ipcRenderer.invoke('lib:addToCollection', args),
  removeFromCollection: (args) => ipcRenderer.invoke('lib:removeFromCollection', args),
  updateCollectionEntry: (args) => ipcRenderer.invoke('lib:updateCollectionEntry', args),
  getWishlist:          (args) => ipcRenderer.invoke('lib:getWishlist', args),
  addToWishlist:        (args) => ipcRenderer.invoke('lib:addToWishlist', args),
  removeFromWishlist:   (args) => ipcRenderer.invoke('lib:removeFromWishlist', args),
  updateWishlistEntry:  (args) => ipcRenderer.invoke('lib:updateWishlistEntry', args),
  logActivity:              (args) => ipcRenderer.invoke('lib:logActivity', args),
  getActivityLog:           (args) => ipcRenderer.invoke('lib:getActivityLog', args),
  saveCanvas:               (args) => ipcRenderer.invoke('lib:saveCanvas', args),
  loadCanvas:               (args) => ipcRenderer.invoke('lib:loadCanvas', args),
  getArrangements:          (args) => ipcRenderer.invoke('lib:getArrangements', args),
  createArrangement:        (args) => ipcRenderer.invoke('lib:createArrangement', args),
  renameArrangement:        (args) => ipcRenderer.invoke('lib:renameArrangement', args),
  deleteArrangement:        (args) => ipcRenderer.invoke('lib:deleteArrangement', args),
  saveArrangementCanvas:    (args) => ipcRenderer.invoke('lib:saveArrangementCanvas', args),
  loadArrangementCanvas:    (args) => ipcRenderer.invoke('lib:loadArrangementCanvas', args),
});

contextBridge.exposeInMainWorld('settingsAPI', {
  get:          ()     => ipcRenderer.invoke('settings:get'),
  set:          (args) => ipcRenderer.invoke('settings:set', args),
  openUserData: ()     => ipcRenderer.invoke('shell:openUserData'),
});

contextBridge.exposeInMainWorld('cardsAPI', {
  getStatus:     ()     => ipcRenderer.invoke('cards:status'),
  startSync:     (args) => ipcRenderer.send('cards:startSync', args),
  search:        (args) => ipcRenderer.invoke('cards:search', args),
  getCard:       (args) => ipcRenderer.invoke('cards:getCard', args),
  getCardImages: (args) => ipcRenderer.invoke('cards:getCardImages', args),
  getCardsBatch: (args) => ipcRenderer.invoke('cards:getCardsBatch', args),
  onProgress:    (cb)   => {
    ipcRenderer.on('cards:progress', (_e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('cards:progress');
  },
});
