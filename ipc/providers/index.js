'use strict';

const { ClaudeCliProvider } = require('./claude-cli');
const { OpenAIProvider }    = require('./openai');
const { createModuleLogger } = require('../../utils/logger');

const log = createModuleLogger('providers');

/** @type {Map<string, new(...args: any[]) => any>} */
const _registry = new Map();

/** @type {import('../../shared/chat-events').AIProvider | null} */
let _activeProvider = null;

function register(id, ProviderClass) {
  _registry.set(id, ProviderClass);
}

/**
 * Returns (or creates) the singleton provider for the current settings.
 * @param {object} settings — result of getSettings()
 */
function getProvider(settings) {
  if (_activeProvider) return _activeProvider;

  const id = settings?.ai?.provider ?? 'claude-cli';
  log.info(`Creating AI provider: ${id}`);

  if (id === 'claude-cli') {
    _activeProvider = new ClaudeCliProvider();
  } else if (id === 'openai') {
    _activeProvider = new OpenAIProvider(settings?.ai?.apiKey, settings?.ai?.modelName);
  } else {
    const Cls = _registry.get(id);
    if (!Cls) {
      log.warn(`Unknown provider "${id}", falling back to claude-cli`);
      _activeProvider = new ClaudeCliProvider();
    } else {
      _activeProvider = new Cls(settings);
    }
  }

  return _activeProvider;
}

/** Call when the user changes the AI provider in Settings. */
function resetProvider() {
  if (_activeProvider) {
    _activeProvider.abort();
    _activeProvider = null;
    log.info('Provider reset');
  }
}

register('claude-cli', ClaudeCliProvider);
register('openai',     OpenAIProvider);

module.exports = { register, getProvider, resetProvider };
