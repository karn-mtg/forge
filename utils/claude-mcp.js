'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Writes .claude/settings.json with resolved MCP server paths.
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
  const settingsPath = path.join(__dirname, '..', '.claude', 'settings.json');

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}

  const mcpServers = {};

  const projectRoot = path.join(__dirname, '..');
  const tsxCjs = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cjs', 'index.cjs');

  // karnforge MCP server — uses the same Electron binary so better-sqlite3
  // bindings match the runtime the app was built against.
  mcpServers.karnforge = {
    command: process.execPath,
    args: ['-r', tsxCjs, path.join(projectRoot, 'mcp', 'index.js')],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    cwd: projectRoot,
  };

  // chat-controller MCP — pushes typed UI events to the renderer via HTTP bridge
  if (chatBridgePort) {
    mcpServers['chat-controller'] = {
      command: process.execPath,
      args: ['-r', tsxCjs, path.join(projectRoot, 'mcp', 'chat-controller', 'index.js')],
      env: {
        ELECTRON_RUN_AS_NODE:  '1',
        KARNFORGE_BRIDGE_PORT: String(chatBridgePort),
      },
      cwd: projectRoot,
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
    console.log('[mcp] Wrote .claude/settings.json with', Object.keys(mcpServers).join(', '));
  } catch (err) {
    console.warn('[mcp] Could not write .claude/settings.json:', err.message);
  }
}

module.exports = { writeClaudeMcpSettings };
