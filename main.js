'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { initLibrary } = require('./db/library');
const { initCards } = require('./db/cards');
const { registerLibraryHandlers } = require('./ipc/library');
const { registerCardsHandlers } = require('./ipc/cards');
const { getSettings, setSettings } = require('./settings');

let mainWindow = null;
let libraryDb = null;
let cardsDb = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0D0D0D',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools automatically in dev so renderer errors are always visible
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.name = 'Karn Forge';

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');

  libraryDb = initLibrary(userDataPath);
  cardsDb = initCards(userDataPath);

  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());

  registerLibraryHandlers(ipcMain, () => libraryDb);
  registerCardsHandlers(ipcMain, () => cardsDb, () => mainWindow);

  ipcMain.handle('settings:get', () => getSettings(userDataPath));
  ipcMain.handle('settings:set', (_, updates) => setSettings(userDataPath, updates));
  ipcMain.handle('shell:openUserData', () => shell.openPath(userDataPath));

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
