'use strict';

const { app, ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { resolveArsenalDir, resolveArsenalDbDir } = require('../utils/paths');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('ipc:arsenal');

// ── CONFIGURE THIS ─────────────────────────────────────────────────────────────
const ARSENAL_GITHUB_REPO = 'karn-mtg/karn';
// ───────────────────────────────────────────────────────────────────────────────

const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Tag prefixes for each independently-versioned component
const TAG_PREFIXES = {
  server: 'server-v',
  cards:  'cards-db-v',
  rules:  'rules-db-v',
};

// Asset naming for each component
const ASSET_TEMPLATES = {
  server: (version, platform) => `karn-arsenal-v${version}-${platform}.zip`,
  cards:  (version)           => `karn-cards-db-v${version}.tar.gz`,
  rules:  (version)           => `karn-rules-db-v${version}.tar.gz`,
};

class ArsenalManager {
  constructor() {
    this.arsenalDir = resolveArsenalDir();
    this.dataDir    = resolveArsenalDbDir();
    // Per-component update caches: server | cards | rules
    this._updateCache = { server: null, cards: null, rules: null };
    this._updateCacheTime = { server: 0, cards: 0, rules: 0 };
    log.debug('ArsenalManager constructed', { arsenalDir: this.arsenalDir, dataDir: this.dataDir });
  }

  /**
   * Returns the full path to a karn-arsenal executable, or null if not found.
   * @param {'karn'} name
   */
  getExecutable(name) {
    const exeName = process.platform === 'win32' ? `${name}.exe` : name;
    const fullPath = path.join(this.arsenalDir, exeName);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  /** Reads arsenalDir/version.txt → server version string or null. */
  getInstalledVersion() {
    try {
      return fs.readFileSync(path.join(this.arsenalDir, 'version.txt'), 'utf8').trim();
    } catch {
      return null;
    }
  }

  /** Reads dataDir/{component}-db-version.txt → version string or null. */
  getInstalledDbVersion(component) {
    try {
      const file = path.join(this.dataDir, `${component}-db-version.txt`);
      return fs.readFileSync(file, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch releases from GitHub and find the latest one whose tag starts with prefix.
   * @returns {Promise<string|null>} version string (without prefix), or null
   */
  async _fetchLatestByPrefix(prefix) {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${ARSENAL_GITHUB_REPO}/releases?per_page=50`,
        headers: { 'User-Agent': 'KarnForge/1.0' },
      };

      const req = https.get(options, (res) => {
        if (res.statusCode !== 200) return resolve(null);
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const releases = JSON.parse(raw);
            const match = releases.find(r => (r.tag_name || '').startsWith(prefix));
            resolve(match ? match.tag_name.slice(prefix.length) : null);
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
  }

  /**
   * Check for a server binary update.
   * Returns { current, latest, hasUpdate }.
   */
  async checkForUpdates() {
    const now = Date.now();
    if (this._updateCache.server && (now - this._updateCacheTime.server) < UPDATE_CACHE_TTL_MS) {
      log.debug('arsenal:checkForUpdates cache HIT', this._updateCache.server);
      return this._updateCache.server;
    }

    const current = this.getInstalledVersion();
    log.info(`arsenal:checkForUpdates server current=${current ?? 'none'}`);
    const latest = await this._fetchLatestByPrefix(TAG_PREFIXES.server);
    const hasUpdate = !!latest && latest !== current;
    const result = { current, latest, hasUpdate };
    this._updateCache.server = result;
    this._updateCacheTime.server = now;
    log.info(`arsenal:checkForUpdates server → current=${current} latest=${latest} hasUpdate=${hasUpdate}`);
    return result;
  }

  /**
   * Check for a database update (cards or rules).
   * @param {'cards'|'rules'} component
   * Returns { current, latest, hasUpdate }.
   */
  async checkForDbUpdates(component) {
    const now = Date.now();
    if (this._updateCache[component] && (now - this._updateCacheTime[component]) < UPDATE_CACHE_TTL_MS) {
      log.debug(`arsenal:checkForDbUpdates ${component} cache HIT`, this._updateCache[component]);
      return this._updateCache[component];
    }

    const current = this.getInstalledDbVersion(component);
    log.info(`arsenal:checkForDbUpdates ${component} current=${current ?? 'none'}`);
    const latest = await this._fetchLatestByPrefix(TAG_PREFIXES[component]);
    const hasUpdate = !!latest && latest !== current;
    const result = { current, latest, hasUpdate };
    this._updateCache[component] = result;
    this._updateCacheTime[component] = now;
    log.info(`arsenal:checkForDbUpdates ${component} → current=${current} latest=${latest} hasUpdate=${hasUpdate}`);
    return result;
  }

  /**
   * Check all three components at once.
   * Returns { server, cards, rules } each with { current, latest, hasUpdate }.
   */
  async checkAllForUpdates() {
    const [server, cards, rules] = await Promise.all([
      this.checkForUpdates(),
      this.checkForDbUpdates('cards'),
      this.checkForDbUpdates('rules'),
    ]);
    return { server, cards, rules };
  }

  /**
   * Downloads and extracts a server binary update.
   * @param {string} version  — bare semver e.g. "1.2.3"
   * @param {(pct: number) => void} onProgress
   */
  async downloadUpdate(version, onProgress) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version: ${version}`);
    log.info(`arsenal:downloadUpdate server v${version}`);

    const platform = process.platform === 'win32' ? 'win'
      : process.platform === 'darwin' ? 'mac'
      : 'linux';

    const assetName = ASSET_TEMPLATES.server(version, platform);
    const downloadUrl = `https://github.com/${ARSENAL_GITHUB_REPO}/releases/download/server-v${version}/${assetName}`;
    const tmpFile = path.join(os.tmpdir(), assetName);

    fs.mkdirSync(this.arsenalDir, { recursive: true });

    await this._downloadFile(downloadUrl, tmpFile, onProgress, 90);

    await this._extractZip(tmpFile, this.arsenalDir);

    fs.writeFileSync(path.join(this.arsenalDir, 'version.txt'), version, 'utf8');

    if (process.platform !== 'win32') {
      const exe = path.join(this.arsenalDir, 'karn');
      if (fs.existsSync(exe)) {
        try { fs.chmodSync(exe, 0o755); } catch { /* ignore */ }
      }
    }

    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    this._invalidateCache('server');

    log.info(`arsenal:downloadUpdate server v${version} complete`);
    if (typeof onProgress === 'function') onProgress(100);
  }

  /**
   * Downloads and extracts a database update (cards or rules).
   * @param {'cards'|'rules'} component
   * @param {string} version  — bare semver e.g. "1.2.3"
   * @param {(pct: number) => void} onProgress
   */
  async downloadDbUpdate(component, version, onProgress) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version: ${version}`);
    log.info(`arsenal:downloadDbUpdate ${component} v${version}`);

    const assetName = ASSET_TEMPLATES[component](version);
    const tag = `${TAG_PREFIXES[component]}${version}`;
    const downloadUrl = `https://github.com/${ARSENAL_GITHUB_REPO}/releases/download/${tag}/${assetName}`;
    const tmpFile = path.join(os.tmpdir(), assetName);

    fs.mkdirSync(this.dataDir, { recursive: true });

    await this._downloadFile(downloadUrl, tmpFile, onProgress, 90);

    await this._extractTarGz(tmpFile, this.dataDir);

    // Write version file
    fs.writeFileSync(path.join(this.dataDir, `${component}-db-version.txt`), version, 'utf8');

    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    this._invalidateCache(component);

    log.info(`arsenal:downloadDbUpdate ${component} v${version} complete`);
    if (typeof onProgress === 'function') onProgress(100);
  }

  /** Stream-download a file with progress reporting up to `progressCap` percent. */
  async _downloadFile(url, destPath, onProgress, progressCap = 90) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      const doRequest = (url, redirectCount = 0) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'));
        https.get(url, { headers: { 'User-Agent': 'KarnForge/1.0' } }, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode)) {
            res.resume();
            return doRequest(res.headers.location, redirectCount + 1);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total > 0 && typeof onProgress === 'function') {
              onProgress(Math.round((downloaded / total) * progressCap));
            }
          });

          res.pipe(file);
          res.on('end', () => { file.close(() => resolve()); });
          res.on('error', reject);
        }).on('error', reject);
      };

      doRequest(url);
    });
  }

  /** Extract a .zip archive using platform tools. */
  async _extractZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        // Escape single quotes for PowerShell single-quoted strings ('' = literal ')
        const psZip  = zipPath.replace(/'/g, "''");
        const psDest = destDir.replace(/'/g, "''");
        const cmd = `powershell -NoProfile -Command "Expand-Archive -Force -Path '${psZip}' -DestinationPath '${psDest}'"`;
        exec(cmd, (err) => { if (err) return reject(err); resolve(); });
      } else {
        exec(`unzip -o "${zipPath}" -d "${destDir}"`, (err) => { if (err) return reject(err); resolve(); });
      }
    });
  }

  /** Extract a .tar.gz archive into destDir. */
  async _extractTarGz(tarPath, destDir) {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        // tar is available on Windows 10+ (build 17063+)
        exec(`tar -xzf "${tarPath}" -C "${destDir}"`, (err) => { if (err) return reject(err); resolve(); });
      } else {
        exec(`tar -xzf "${tarPath}" -C "${destDir}"`, (err) => { if (err) return reject(err); resolve(); });
      }
    });
  }

  _invalidateCache(component) {
    this._updateCache[component] = null;
    this._updateCacheTime[component] = 0;
  }

  /** Returns current status snapshot. */
  getStatus() {
    const exe = this.getExecutable('karn');
    const status = {
      installed:      !!exe,
      version:        this.getInstalledVersion(),
      cardsDbVersion: this.getInstalledDbVersion('cards'),
      rulesDbVersion: this.getInstalledDbVersion('rules'),
    };
    log.debug('arsenal:getStatus', status);
    return status;
  }

  /**
   * Registers all IPC handlers.
   * @param {import('electron').IpcMain} ipcMainRef
   */
  registerIpcHandlers(ipcMainRef) {
    ipcMainRef.handle('arsenal:getStatus', () => this.getStatus());

    // Server update
    ipcMainRef.handle('arsenal:checkForUpdates', () => this.checkForUpdates());
    ipcMainRef.handle('arsenal:downloadUpdate', async (event, version) => {
      await this.downloadUpdate(version, (pct) => {
        if (!event.sender.isDestroyed()) event.sender.send('arsenal:progress', { component: 'server', pct });
      });
    });

    // DB updates (cards / rules)
    ipcMainRef.handle('arsenal:checkForDbUpdates', (_, component) => this.checkForDbUpdates(component));
    ipcMainRef.handle('arsenal:downloadDbUpdate', async (event, component, version) => {
      await this.downloadDbUpdate(component, version, (pct) => {
        if (!event.sender.isDestroyed()) event.sender.send('arsenal:progress', { component, pct });
      });
    });

    // Check all three at once
    ipcMainRef.handle('arsenal:checkAllForUpdates', () => this.checkAllForUpdates());

    ipcMainRef.handle('arsenal:restart', () => this.getStatus());
  }
}

module.exports = ArsenalManager;
