'use strict';

const fs   = require('fs');
const path = require('path');

// ANSI escape codes — no deps
const C = {
  DEBUG: '\x1b[90m',  // dark gray
  INFO:  '\x1b[36m',  // cyan
  WARN:  '\x1b[33m',  // yellow
  ERROR: '\x1b[31m',  // red
  BOLD:  '\x1b[1m',
  DIM:   '\x1b[2m',
  RESET: '\x1b[0m',
};

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

const _minLevel = process.env.LOG_LEVEL
  ? (LEVELS[process.env.LOG_LEVEL.toUpperCase()] ?? LEVELS.DEBUG)
  : (process.env.NODE_ENV === 'production' ? LEVELS.INFO : LEVELS.DEBUG);

let _stream = null;
let _logsDir = null;

/**
 * Call once at app startup with the user data directory.
 * Creates ~/karnData/user/logs/karnforge.log (rotated at 5 MB).
 */
function initLogger(userDir) {
  try {
    _logsDir = path.join(userDir, 'logs');
    fs.mkdirSync(_logsDir, { recursive: true });
    const logPath = path.join(_logsDir, 'karnforge.log');

    try {
      if (fs.statSync(logPath).size > 5 * 1024 * 1024) {
        fs.renameSync(logPath, path.join(_logsDir, 'karnforge.old.log'));
      }
    } catch { /* first run — file doesn't exist yet */ }

    _stream = fs.createWriteStream(logPath, { flags: 'a' });
    _write('INFO', 'logger', `=== KarnForge started === PID=${process.pid} NODE_ENV=${process.env.NODE_ENV ?? 'unknown'} minLevel=${Object.keys(LEVELS).find(k => LEVELS[k] === _minLevel)}`);
  } catch (err) {
    console.error('[logger] Failed to initialize log file:', err.message);
  }
}

function getLogsDir() { return _logsDir; }

function _write(level, module, message, data) {
  const lvl = LEVELS[level] ?? LEVELS.INFO;
  if (lvl < _minLevel) return;

  const ts   = new Date().toISOString();
  const lvlPad = level.padEnd(5);
  const dataStr = data !== undefined
    ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data))
    : '';

  // Terminal (colored)
  const color = C[level] ?? C.INFO;
  process.stdout.write(
    `${C.DIM}[${ts}]${C.RESET} ${color}[${lvlPad}]${C.RESET} ${C.BOLD}[${module}]${C.RESET} ${message}${C.DIM}${dataStr}${C.RESET}\n`,
  );

  // File (plain text)
  if (_stream) {
    _stream.write(`[${ts}] [${lvlPad}] [${module}] ${message}${dataStr}\n`);
  }
}

/**
 * Returns a logger bound to a module name.
 * @param {string} module  e.g. 'ipc:library', 'db:cards', 'settings'
 */
function createModuleLogger(module) {
  return {
    debug: (msg, data) => _write('DEBUG', module, msg, data),
    info:  (msg, data) => _write('INFO',  module, msg, data),
    warn:  (msg, data) => _write('WARN',  module, msg, data),
    error: (msg, data) => _write('ERROR', module, msg, data),
  };
}

module.exports = { initLogger, getLogsDir, createModuleLogger };
