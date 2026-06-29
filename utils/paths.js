'use strict';

const os   = require('os');
const path = require('path');

/**
 * Returns the root karn data directory for the current user.
 *
 * Windows : C:\Users\<user>\karnData
 * macOS   : ~/.karnData
 * Linux   : ~/.karnData
 *
 * All KarnForge data (library, settings, arsenal binaries, card DB) lives
 * under this root so it is decoupled from the app installation path and
 * accessible to any tool — Electron, MCP servers, CLI scripts, etc.
 */
function resolveKarnDataDir() {
  const isDev = process.env.NODE_ENV === 'development';
  const baseName = process.platform === 'win32' ? 'karnData' : '.karnData';
  const dirName = isDev ? `${baseName}-dev` : baseName;
  return path.join(os.homedir(), dirName);
}

/** ~/karnData/user/ — KarnForge library.db and settings.json */
function resolveUserDir() {
  return path.join(resolveKarnDataDir(), 'user');
}

/** ~/karnData/arsenal/ — karn-arsenal executables and version.txt */
function resolveArsenalDir() {
  return path.join(resolveKarnDataDir(), 'arsenal');
}

/** ~/karnData/arsenal/db/ — prints.db written by karn-arsenal */
function resolveArsenalDbDir() {
  return path.join(resolveArsenalDir(), 'db');
}

module.exports = { resolveKarnDataDir, resolveUserDir, resolveArsenalDir, resolveArsenalDbDir };
