'use strict';

const { spawn }  = require('child_process');
const path       = require('path');
const providerRegistry = require('./providers/index');
const { checkClaude }  = require('./providers/claude-cli');
const lib              = require('../db/library');
const { createModuleLogger } = require('../utils/logger');

const log = createModuleLogger('ipc:ai');
const PROJECT_ROOT = path.join(__dirname, '..');

// card query subprocess is still stateless and claude-specific
let cardQueryProc = null;

module.exports = { registerAIHandlers };

function registerAIHandlers(ipcMain, getLibDb, getSettings) {

  // ── Main chat ──────────────────────────────────────────────────────────────

  ipcMain.handle('ai:chat', (event, { text, context, sessionHandle }) => {
    return new Promise(async (resolve, reject) => {
      const provider = providerRegistry.getProvider(getSettings());
      provider.abort(); // kill any in-flight request

      log.info(`ai:chat via provider=${provider.id}`);

      try {
        for await (const chunk of provider.chat({ message: text, context, sessionHandle, history: [] })) {
          if (chunk.kind === 'token') {
            event.sender.send('ai:token', chunk.delta);
          } else if (chunk.kind === 'done') {
            event.sender.send('ai:done', { sessionId: chunk.sessionHandle ?? null });
            resolve();
          } else if (chunk.kind === 'error') {
            event.sender.send('ai:error', chunk.message);
          }
        }
        resolve();
      } catch (e) {
        log.error(`ai:chat error: ${e.message}`);
        event.sender.send('ai:error', e.message);
        reject(e);
      }
    });
  });

  ipcMain.handle('ai:abort', () => {
    log.info('ai:abort');
    const provider = providerRegistry.getProvider(getSettings());
    provider.abort();
    return { ok: true };
  });

  ipcMain.handle('ai:clearSession', () => {
    log.info('ai:clearSession');
    // Session handle is now managed by the caller (useAIStore) — nothing to do here.
    return { ok: true };
  });

  ipcMain.handle('ai:resetProvider', () => {
    log.info('ai:resetProvider');
    providerRegistry.resetProvider();
    return { ok: true };
  });

  ipcMain.handle('ai:checkClaude', async () => {
    log.debug('ai:checkClaude');
    const result = await checkClaude();
    log.info(`ai:checkClaude → installed=${result.installed} loggedIn=${result.loggedIn} method=${result.method ?? 'none'}`);
    return result;
  });

  // ── Agent memory ───────────────────────────────────────────────────────────

  ipcMain.handle('ai:getMemory',    ()       => lib.getAgentMemories(getLibDb()));
  ipcMain.handle('ai:upsertMemory', (_, args) => lib.upsertAgentMemory(getLibDb(), args));
  ipcMain.handle('ai:deleteMemory', (_, args) => lib.deleteAgentMemory(getLibDb(), args));

  // ── Conversation persistence ───────────────────────────────────────────────

  ipcMain.handle('ai:createConversation',       (_, args) => lib.createAIConversation(getLibDb(), args));
  ipcMain.handle('ai:getConversations',         (_, args) => lib.getAIConversations(getLibDb(), args ?? {}));
  ipcMain.handle('ai:getConversation',          (_, args) => lib.getAIConversation(getLibDb(), args));
  ipcMain.handle('ai:deleteConversation',       (_, args) => lib.deleteAIConversation(getLibDb(), args));
  ipcMain.handle('ai:appendMessage',            (_, args) => lib.appendAIMessage(getLibDb(), args));
  ipcMain.handle('ai:updateConversationHandle', (_, { id, sessionHandle }) => {
    const db = getLibDb();
    db.prepare('UPDATE ai_conversations SET session_handle = ? WHERE id = ?').run(sessionHandle, id);
    return { ok: true };
  });
  ipcMain.handle('ai:addDeclinedOracleId', (_, args) => lib.addDeclinedOracleId(getLibDb(), args));

  // ── Card query (stateless Claude CLI subprocess) ───────────────────────────

  ipcMain.handle('ai:cardQuery', (event, { prompt }) => {
    return new Promise((resolve) => {
      if (cardQueryProc) {
        log.warn('ai:cardQuery — killing existing card query process');
        cardQueryProc.kill();
        cardQueryProc = null;
      }

      log.info(`ai:cardQuery prompt="${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}"`);

      const systemInstruction = [
        'You are a Magic: The Gathering card search assistant. Use the search_cards tool from the karn MCP server for semantic and graph-based card search.',
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
              const textBlock = (evt.message?.content ?? []).find(b => b.type === 'text');
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
      log.info('ai:cardQueryAbort');
      cardQueryProc.kill();
      cardQueryProc = null;
    }
    return { ok: true };
  });

  log.info('Registered ai: handlers');
}
