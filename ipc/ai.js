'use strict';

const { spawn, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const lib  = require('../db/library');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('ipc:ai');
const PROJECT_ROOT = path.join(__dirname, '..');

let currentSessionId = null;
let currentProc = null;
let cardQueryProc = null;

module.exports = { registerAIHandlers };

function checkInstalled() {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { shell: true, timeout: 5000 }, (err, stdout) => {
      if (err) {
        log.warn('Claude CLI not found in PATH');
        resolve({ installed: false, version: null });
      } else {
        const version = stdout.trim().split('\n')[0] || 'unknown';
        log.info(`Claude CLI found: ${version}`);
        resolve({ installed: true, version });
      }
    });
  });
}

function checkLoggedIn() {
  // Check env var auth first (API key or OAuth token)
  if (process.env.ANTHROPIC_API_KEY)        return { loggedIn: true, method: 'api_key' };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN)  return { loggedIn: true, method: 'env_token' };

  // Check OAuth credentials file written by `claude login`
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  try {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const oauth = creds?.claudeAiOauth;
    if (oauth?.accessToken) {
      const expired = oauth.expiresAt && Date.now() > new Date(oauth.expiresAt).getTime();
      return { loggedIn: true, method: 'oauth', expired: !!expired };
    }
  } catch { /* file missing or malformed */ }

  return { loggedIn: false, method: null };
}

function registerAIHandlers(ipcMain, getLibDb) {
  ipcMain.handle('ai:chat', (event, { text }) => {
    return new Promise((resolve, reject) => {
      if (currentProc) {
        log.warn('ai:chat — killing existing process before new chat');
        currentProc.kill();
        currentProc = null;
      }

      const args = ['-p', text, '--output-format', 'stream-json', '--verbose'];
      const isResume = !!currentSessionId;
      if (currentSessionId) args.push('--resume', currentSessionId);

      log.info(`ai:chat ${isResume ? 'resume session=' + currentSessionId : 'new session'} prompt="${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);

      // shell:true lets Windows find claude.cmd via PATH
      // cwd ensures Claude picks up .claude/settings.json and resolves MCP servers
      currentProc = spawn('claude', args, {
        shell: true,
        cwd: PROJECT_ROOT,
        env: { ...process.env },
      });

      let buffer = '';
      let previousText = '';
      let tokenCount = 0;

      currentProc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'assistant') {
              const blocks = evt.message?.content ?? [];
              const textBlock = blocks.find(b => b.type === 'text');
              if (textBlock) {
                const fullText = textBlock.text ?? '';
                if (fullText.length > previousText.length) {
                  const delta = fullText.slice(previousText.length);
                  event.sender.send('ai:token', delta);
                  previousText = fullText;
                  tokenCount += delta.length;
                }
              }
            }
            if (evt.type === 'result') {
              if (evt.session_id) currentSessionId = evt.session_id;
              log.info(`ai:chat done sessionId=${evt.session_id ?? 'none'} chars=${tokenCount}`);
              event.sender.send('ai:done', { sessionId: evt.session_id ?? null });
              currentProc = null;
              resolve();
            }
          } catch {
            // skip malformed lines
          }
        }
      });

      currentProc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) {
          log.warn(`ai:chat stderr: ${msg}`);
          event.sender.send('ai:error', msg);
        }
      });

      currentProc.on('error', (e) => {
        const msg = e.code === 'ENOENT'
          ? 'Claude Code not found. Make sure it is installed and in PATH.'
          : `Failed to start Claude: ${e.message}`;
        log.error(`ai:chat process error: ${msg}`);
        event.sender.send('ai:error', msg);
        currentProc = null;
        reject(e);
      });

      currentProc.on('close', (code) => {
        currentProc = null;
        if (code !== 0 && code !== null) {
          log.warn(`ai:chat process exited with code ${code}`);
          // process exited without a result event
          event.sender.send('ai:error', `Claude exited with code ${code}`);
          resolve(); // resolve so the IPC call doesn't hang
        }
      });
    });
  });

  ipcMain.handle('ai:abort', () => {
    if (currentProc) {
      log.info('ai:abort — killing chat process');
      currentProc.kill();
      currentProc = null;
    }
    return { ok: true };
  });

  ipcMain.handle('ai:clearSession', () => {
    log.info(`ai:clearSession — was ${currentSessionId ?? 'null'}`);
    currentSessionId = null;
    return { ok: true };
  });

  ipcMain.handle('ai:checkClaude', async () => {
    log.debug('ai:checkClaude');
    const [installResult, authResult] = await Promise.all([checkInstalled(), Promise.resolve(checkLoggedIn())]);
    log.info(`ai:checkClaude → installed=${installResult.installed} loggedIn=${authResult.loggedIn} method=${authResult.method ?? 'none'}`);
    return { ...installResult, ...authResult };
  });

  ipcMain.handle('ai:getMemory', () => lib.getAgentMemories(getLibDb()));
  ipcMain.handle('ai:upsertMemory', (_, args) => lib.upsertAgentMemory(getLibDb(), args));
  ipcMain.handle('ai:deleteMemory', (_, args) => lib.deleteAgentMemory(getLibDb(), args));

  ipcMain.handle('ai:cardQuery', (event, { prompt }) => {
    return new Promise((resolve) => {
      if (cardQueryProc) {
        log.warn('ai:cardQuery — killing existing card query process');
        cardQueryProc.kill();
        cardQueryProc = null;
      }

      log.info(`ai:cardQuery prompt="${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}"`);

      const systemInstruction = [
        'You are a Magic: The Gathering card search assistant with access to the search_cards MCP tool.',
        'Use search_cards to find cards matching the user\'s request. You may call it multiple times.',
        'After your brief explanation, end your ENTIRE response with this exact tag on its own line:',
        '<cards>["oracle-id-1","oracle-id-2"]</cards>',
        'Put the oracle_id values (UUIDs) of the matched cards in that JSON array. Include at most 30.',
        'Only include cards that genuinely match the request.',
      ].join(' ');

      const fullPrompt = `${systemInstruction}\n\nUser request: ${prompt}`;
      const args = ['-p', fullPrompt, '--output-format', 'stream-json', '--verbose'];

      cardQueryProc = spawn('claude', args, { shell: true, cwd: PROJECT_ROOT, env: { ...process.env } });

      let buffer = '';
      let rawAccumulated = '';
      let displayAccumulated = '';

      cardQueryProc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'assistant') {
              const blocks = evt.message?.content ?? [];
              const textBlock = blocks.find(b => b.type === 'text');
              if (textBlock) {
                const fullRaw = textBlock.text ?? '';
                if (fullRaw.length > rawAccumulated.length) {
                  rawAccumulated = fullRaw;
                  const displayFull = fullRaw.replace(/<cards>[\s\S]*?<\/cards>/g, '').trimEnd();
                  if (displayFull.length > displayAccumulated.length) {
                    const delta = displayFull.slice(displayAccumulated.length);
                    if (delta) event.sender.send('ai:cardQueryToken', delta);
                    displayAccumulated = displayFull;
                  }
                }
              }
            }
            if (evt.type === 'result') {
              const match = rawAccumulated.match(/<cards>([\s\S]*?)<\/cards>/);
              let oracleIds = [];
              if (match) {
                try { oracleIds = JSON.parse(match[1].trim()); } catch {}
              }
              log.info(`ai:cardQuery done → ${oracleIds.length} oracle IDs`);
              event.sender.send('ai:cardQueryResult', { oracleIds });
              event.sender.send('ai:cardQueryDone');
              cardQueryProc = null;
              resolve();
            }
          } catch {}
        }
      });

      cardQueryProc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) {
          log.warn(`ai:cardQuery stderr: ${msg}`);
          event.sender.send('ai:cardQueryError', msg);
        }
      });

      cardQueryProc.on('error', (e) => {
        const msg = e.code === 'ENOENT'
          ? 'Claude Code not found. Make sure it is installed and in PATH.'
          : `Failed to start Claude: ${e.message}`;
        log.error(`ai:cardQuery process error: ${msg}`);
        event.sender.send('ai:cardQueryError', msg);
        cardQueryProc = null;
        resolve();
      });

      cardQueryProc.on('close', (code) => {
        cardQueryProc = null;
        if (code !== 0 && code !== null) {
          log.warn(`ai:cardQuery process exited with code ${code}`);
          event.sender.send('ai:cardQueryError', `Claude exited with code ${code}`);
          resolve();
        }
      });
    });
  });

  ipcMain.handle('ai:cardQueryAbort', () => {
    if (cardQueryProc) {
      log.info('ai:cardQueryAbort — killing card query process');
      cardQueryProc.kill();
      cardQueryProc = null;
    }
    return { ok: true };
  });

  log.info('Registered ai: handlers');
}
