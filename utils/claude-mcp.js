'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Writes .claude/settings.json with resolved MCP server paths.
 * Called once at app startup so Claude always finds the right executables.
 *
 * Three servers are registered:
 *   karnforge  — this app's own MCP server (library, card search via SQLite)
 *   karn-cards — arsenal semantic card search (if installed)
 *   karn-rules — arsenal rules MCP (if installed)
 *
 * Claude spawns these on-demand via stdio transport; Electron does not manage
 * their lifecycle.
 */
function writeClaudeMcpSettings(arsenal) {
  const settingsPath = path.join(__dirname, '..', '.claude', 'settings.json');

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}

  const mcpServers = {};

  const projectRoot = path.join(__dirname, '..');
  const tsxCjs = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cjs', 'index.cjs');

  // karnforge MCP server — uses the same Electron binary so better-sqlite3
  // bindings match the runtime the app was built against.
  // cwd and absolute tsx path ensure Claude can resolve everything regardless
  // of where it spawns the process from.
  mcpServers.karnforge = {
    command: process.execPath,
    args: ['-r', tsxCjs, path.join(projectRoot, 'mcp', 'index.js')],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    cwd: projectRoot,
  };

  // arsenal servers — only register if the executables are present
  const cardsExe = arsenal.getExecutable('karn-cards');
  if (cardsExe) {
    mcpServers['karn-cards'] = {
      command: cardsExe,
      env: { KARN_DATA_DIR: arsenal.dataDir },
      cwd: arsenal.arsenalDir,
    };
  }

  const rulesExe = arsenal.getExecutable('karn-rules');
  if (rulesExe) {
    mcpServers['karn-rules'] = {
      command: rulesExe,
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
