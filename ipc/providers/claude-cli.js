'use strict';

const { spawn, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { createModuleLogger } = require('../../utils/logger');

const log = createModuleLogger('provider:claude-cli');
const PROJECT_ROOT = path.join(__dirname, '..', '..');

const SYSTEM_PROMPT_PATH = path.resolve(
  __dirname, '..', '..', '..', 'karn', 'agent', 'system-prompt.md'
);

function loadBaseSystemPrompt() {
  try {
    return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  } catch {
    log.warn('Karn agent system prompt not found — using empty prompt');
    return '';
  }
}

function buildSystemPrompt(context) {
  const base = loadBaseSystemPrompt();
  if (!context) return base;
  return `${base}\n\n---\n${context}`;
}

// ─────────────────────────────────────────────────────────────────────────────

class ClaudeCliProvider {
  constructor() {
    this.id   = 'claude-cli';
    this.name = 'Claude (CLI)';
    this._proc = null;
  }

  getCapabilities() {
    return { supportsMCP: true, nativeHistory: true, supportsSystemPrompt: true };
  }

  /**
   * Yields ProviderChunks: { kind:'token', delta } | { kind:'done', sessionHandle } | { kind:'error', message }
   * @param {import('../../shared/chat-events').ChatInput} input
   */
  async *chat(input) {
    const { message, context, sessionHandle } = input;
    const isResume = !!sessionHandle;

    const args = ['--output-format', 'stream-json', '--verbose'];

    if (isResume) {
      args.push('--resume', sessionHandle);
      // Claude ignores --system-prompt on --resume; inject context into the message instead
      const contextBlock = context ? `[Context]\n${context}\n\n` : '';
      args.push('-p', `${contextBlock}${message}`);
    } else {
      const sysPmt = buildSystemPrompt(context);
      if (sysPmt) args.push('--system-prompt', sysPmt);
      args.push('-p', message);
    }

    log.info(
      `chat ${isResume ? 'resume session=' + sessionHandle : 'new session'} ` +
      `prompt="${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`
    );

    const proc = spawn('claude', args, {
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env },
    });
    this._proc = proc;

    let buffer = '';
    let previousText = '';

    const chunks = [];
    let resolveNext = null;
    let done = false;
    let error = null;

    const push = (chunk) => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: chunk, done: false });
      } else {
        chunks.push(chunk);
      }
    };

    const finish = () => {
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined, done: true });
      }
    };

    proc.stdout.on('data', (chunk) => {
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
              const fullText = textBlock.text ?? '';
              if (fullText.length > previousText.length) {
                const delta = fullText.slice(previousText.length);
                previousText = fullText;
                push({ kind: 'token', delta });
              }
            }
          }

          if (evt.type === 'result') {
            log.info(`chat done sessionHandle=${evt.session_id ?? 'none'}`);
            push({ kind: 'done', sessionHandle: evt.session_id ?? undefined });
            this._proc = null;
            finish();
          }
        } catch { /* skip malformed lines */ }
      }
    });

    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) {
        log.warn(`stderr: ${msg}`);
        push({ kind: 'error', message: msg });
      }
    });

    proc.on('error', (e) => {
      const msg = e.code === 'ENOENT'
        ? 'Claude Code not found. Make sure it is installed and in PATH.'
        : `Failed to start Claude: ${e.message}`;
      log.error(`process error: ${msg}`);
      error = msg;
      push({ kind: 'error', message: msg });
      this._proc = null;
      finish();
    });

    proc.on('close', (code) => {
      this._proc = null;
      if (!done && code !== 0 && code !== null) {
        log.warn(`process exited with code ${code}`);
        push({ kind: 'error', message: `Claude exited with code ${code}` });
        finish();
      } else if (!done) {
        finish();
      }
    });

    // Async generator: yield from the push queue
    while (true) {
      if (chunks.length > 0) {
        yield chunks.shift();
      } else if (done) {
        return;
      } else {
        const next = await new Promise((resolve) => { resolveNext = resolve; });
        if (next.done) return;
        yield next.value;
      }
    }
  }

  abort() {
    if (this._proc) {
      log.info('aborting chat process');
      this._proc.kill();
      this._proc = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function checkInstalled() {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { shell: true, timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve({ installed: false, version: null });
      } else {
        resolve({ installed: true, version: stdout.trim().split('\n')[0] || 'unknown' });
      }
    });
  });
}

function checkLoggedIn() {
  if (process.env.ANTHROPIC_API_KEY)       return { loggedIn: true, method: 'api_key' };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { loggedIn: true, method: 'env_token' };

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

async function checkClaude() {
  const [installResult, authResult] = await Promise.all([
    checkInstalled(),
    Promise.resolve(checkLoggedIn()),
  ]);
  return { ...installResult, ...authResult };
}

module.exports = { ClaudeCliProvider, checkClaude };
