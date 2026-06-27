'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const path = require('path');
const { initLibrary } = require('./db/library');
const { initCards } = require('./db/cards');
const { registerLibraryHandlers } = require('./ipc/library');
const { registerCardsHandlers }   = require('./ipc/cards');
const { registerAIHandlers }      = require('./ipc/ai');
const { getSettings, setSettings } = require('./settings');
const ArsenalManager = require('./ipc/arsenal');
const { resolveUserDir } = require('./utils/paths');
const { writeClaudeMcpSettings } = require('./utils/claude-mcp');
const { initLogger, getLogsDir, createModuleLogger } = require('./utils/logger');

const log = createModuleLogger('main');

let mainWindow = null;
let libraryDb = null;
let cardsDb = null;

// ── Chat controller HTTP bridge ────────────────────────────────────────────────
// The chat-controller MCP subprocess cannot call ipcMain directly.
// We expose a localhost HTTP server so it can push UI events to the renderer.

function startChatBridge() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }

      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch {
          res.writeHead(400).end('{"error":"invalid json"}');
          return;
        }

        if (req.url === '/emit') {
          // Fire-and-forget: push event to renderer
          mainWindow?.webContents.send('ai:block', payload.event);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');

        } else if (req.url === '/ask') {
          // Long-poll: hold open until renderer responds or timeout
          const { event, requestId } = payload;
          if (!requestId) { res.writeHead(400).end('{"error":"missing requestId"}'); return; }

          mainWindow?.webContents.send('ai:ask', { ...event, requestId });

          const timeout = setTimeout(() => {
            if (!res.writableEnded) res.writeHead(408).end('{"error":"timeout"}');
          }, 300_000);

          ipcMain.once(`ai:askResponse:${requestId}`, (_, value) => {
            clearTimeout(timeout);
            if (!res.writableEnded) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ value }));
            }
          });

        } else {
          res.writeHead(404).end();
        }
      });
    });

    // Bind only to loopback — never expose to the network
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      log.info(`Chat bridge HTTP server listening on 127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

function createWindow() {
  log.info('Creating BrowserWindow');
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
    log.info('Dev mode — loading http://localhost:5173 and opening DevTools');
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools automatically in dev so renderer errors are always visible
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.join(__dirname, 'dist', 'renderer', 'index.html');
    log.info('Prod mode — loading', indexHtml);
    mainWindow.loadFile(indexHtml);
  }

  mainWindow.once('ready-to-show', () => { log.info('Window ready-to-show'); mainWindow.show(); });
  mainWindow.on('closed', () => { log.info('Window closed'); mainWindow = null; });
}

app.name = 'Karn Forge';

app.whenReady().then(async () => {
  const userDir = resolveUserDir();

  // Logger must be initialized before anything else so all subsequent logs go to file
  initLogger(userDir);
  log.info('App ready', { userDir, version: app.getVersion(), platform: process.platform });

  log.info('Initializing library DB');
  libraryDb = initLibrary(userDir);
  log.info('Library DB ready');

  const arsenal = new ArsenalManager();
  log.info('Arsenal manager created', { arsenalDir: arsenal.arsenalDir, dataDir: arsenal.dataDir });

  // initCards returns null if prints.db hasn't been created by karn-arsenal yet
  log.info('Initializing cards DB');
  cardsDb = initCards(arsenal.dataDir);
  if (cardsDb) {
    log.info('Cards DB ready');
  } else {
    log.warn('Cards DB not available — prints.db not found (install Arsenal to enable card search)');
  }

  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());

  log.info('Registering IPC handlers');
  registerLibraryHandlers(ipcMain, () => libraryDb);
  registerCardsHandlers(ipcMain, () => cardsDb, () => mainWindow);
  registerAIHandlers(ipcMain, () => libraryDb, () => getSettings(userDir));

  ipcMain.handle('settings:get', () => getSettings(userDir));
  ipcMain.handle('settings:set', (_, updates) => setSettings(userDir, updates));
  ipcMain.handle('shell:openUserData', () => shell.openPath(userDir));
  ipcMain.handle('shell:openLogs', () => {
    const logsDir = getLogsDir();
    if (logsDir) {
      log.info('Opening logs folder', logsDir);
      return shell.openPath(logsDir);
    }
  });

  arsenal.registerIpcHandlers(ipcMain);
  log.info('All IPC handlers registered');

  // Start chat bridge before writing MCP settings so the port is known
  const chatBridgePort = await startChatBridge();

  // Register arsenal + karnforge + chat-controller MCP servers in .claude/settings.json
  writeClaudeMcpSettings(arsenal, { chatBridgePort });

  createWindow();
});

app.on('window-all-closed', () => {
  log.info('All windows closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
