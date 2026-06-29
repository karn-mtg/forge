'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * Writes ~/.claude/settings.json with resolved MCP server paths.
 * Called once at app startup so Claude always finds the right executables.
 *
 * Three servers are registered:
 *   karnforge       — library, card search via SQLite (this app's own MCP)
 *   chat-controller — UI event bridge (emits blocks/asks back to the renderer)
 *   karn            — arsenal: semantic card search + rules (if installed)
 *
 * Claude spawns these on-demand via stdio transport; Electron does not manage
 * their lifecycle.
 */
function writeClaudeMcpSettings(arsenal, { chatBridgePort } = {}) {
  // Write to the user's real home directory, not a path inside the asar archive.
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}

  const mcpServers = {};

  // In a packaged build the source files are in app.asar.unpacked (see asarUnpack
  // in package.json). In dev they live in the real project directory.
  const projectRoot = _resolveProjectRoot();
  const tsxCjs = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cjs', 'index.cjs');

  // NODE_PATH lets the MCP subprocess find packages in the asar's node_modules
  // (e.g. better-sqlite3) even when the script itself runs from the unpacked dir.
  const nodeModulesPath = _resolveNodeModulesPath();
  const baseEnv = {
    ELECTRON_RUN_AS_NODE: '1',
    ...(nodeModulesPath ? { NODE_PATH: nodeModulesPath } : {}),
  };

  // karnforge MCP server — uses the same Electron binary so better-sqlite3
  // bindings match the runtime the app was built against.
  mcpServers.karnforge = {
    command: process.execPath,
    args: ['-r', tsxCjs, path.join(projectRoot, 'mcp', 'index.js')],
    env: baseEnv,
    cwd: os.homedir(),
  };

  // chat-controller MCP — pushes typed UI events to the renderer via HTTP bridge
  if (chatBridgePort) {
    mcpServers['chat-controller'] = {
      command: process.execPath,
      args: ['-r', tsxCjs, path.join(projectRoot, 'mcp', 'chat-controller', 'index.js')],
      env: {
        ...baseEnv,
        KARNFORGE_BRIDGE_PORT: String(chatBridgePort),
      },
      cwd: os.homedir(),
    };
  }

  // arsenal server — only register if the executable is present
  const karnExe = arsenal.getExecutable('karn');
  if (karnExe) {
    mcpServers['karn'] = {
      command: karnExe,
      env: { KARN_DATA_DIR: arsenal.dataDir },
      cwd: arsenal.arsenalDir,
    };
  }

  const updated = { ...existing, mcpServers };

  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + '\n');
    console.log('[mcp] Wrote ~/.claude/settings.json with', Object.keys(mcpServers).join(', '));
  } catch (err) {
    console.warn('[mcp] Could not write ~/.claude/settings.json:', err.message);
  }
}

/**
 * Returns the root directory that contains mcp/, db/, utils/, and node_modules/.
 * In a packaged build this is the app.asar.unpacked directory on the real
 * filesystem; in dev it is the forge/ project directory.
 */
function _resolveProjectRoot() {
  try {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'app.asar.unpacked');
    }
  } catch { /* running outside Electron (tests, etc.) */ }
  return path.join(__dirname, '..');
}

/**
 * Returns the node_modules path that subprocess workers should use for
 * resolving packages. In production this points into the asar archive so
 * that Electron's patched fs can serve reads from it.
 */
function _resolveNodeModulesPath() {
  try {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(app.getAppPath(), 'node_modules');
    }
  } catch {}
  return '';
}

module.exports = { writeClaudeMcpSettings };
