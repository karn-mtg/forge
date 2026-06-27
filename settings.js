'use strict';

const fs   = require('fs');
const path = require('path');
const { createModuleLogger } = require('./utils/logger');

const log = createModuleLogger('settings');

let _safeStorage = null;
function getSafeStorage() {
  if (!_safeStorage) {
    try { _safeStorage = require('electron').safeStorage; } catch { _safeStorage = null; }
  }
  return _safeStorage;
}

// In-memory settings cache — avoids repeated disk reads and OS keychain decryption per IPC call
let _settingsCache = null;

const DEFAULTS = {
  defaultFormat: 'commander',
  ai: {
    provider:  'claude-cli',
    modelName: '',
  },
};

function getSettingsPath(userDir) {
  fs.mkdirSync(userDir, { recursive: true });
  return path.join(userDir, 'settings.json');
}

function getSettings(userDir) {
  if (_settingsCache) return _settingsCache;
  try {
    const raw = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(getSettingsPath(userDir), 'utf8')) };
    // Decrypt API key before returning to callers
    const ss = getSafeStorage();
    if (ss && raw.ai?.apiKeyEncrypted && ss.isEncryptionAvailable()) {
      try {
        raw.ai.apiKey = ss.decryptString(Buffer.from(raw.ai.apiKeyEncrypted, 'base64'));
        log.debug('API key decrypted successfully');
      } catch { /* decryption failed — leave key absent */
        log.warn('API key decryption failed');
      }
      delete raw.ai.apiKeyEncrypted;
    }
    const keys = Object.keys(raw).filter(k => k !== 'ai');
    log.debug('getSettings', { keys });
    _settingsCache = raw;
    return raw;
  } catch {
    log.debug('getSettings — no settings file, returning defaults');
    return { ...DEFAULTS };
  }
}

function setSettings(userDir, updates) {
  const updateKeys = Object.keys(updates).filter(k => k !== 'ai');
  log.debug('setSettings', { keys: updateKeys });

  _settingsCache = null; // invalidate so getSettings re-reads from disk below
  const current = getSettings(userDir);
  _settingsCache = null; // clear before the write so we can set the final merged value
  // Re-read raw (with encrypted key intact) so we don't overwrite with decrypted version
  let rawCurrent = {};
  try { rawCurrent = JSON.parse(fs.readFileSync(getSettingsPath(userDir), 'utf8')); } catch {}

  const next = { ...rawCurrent, ...updates };

  // Encrypt API key before persisting
  const ss = getSafeStorage();
  if (ss && next.ai?.apiKey && ss.isEncryptionAvailable()) {
    next.ai.apiKeyEncrypted = ss.encryptString(next.ai.apiKey).toString('base64');
    delete next.ai.apiKey;
    log.debug('API key encrypted and persisted');
  }

  fs.writeFileSync(getSettingsPath(userDir), JSON.stringify(next, null, 2));
  log.info('Settings saved');
  const merged = { ...current, ...updates };
  _settingsCache = merged;
  return merged;
}

module.exports = { getSettings, setSettings };
