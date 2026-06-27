'use strict';

// Stub — implement when OpenAI support is added.
// Install @anthropic-ai/sdk or openai package and replace the chat() body.

class OpenAIProvider {
  constructor(_apiKey, _modelName = 'gpt-4o') {
    this.id   = 'openai';
    this.name = 'OpenAI';
  }

  getCapabilities() {
    return { supportsMCP: false, nativeHistory: false, supportsSystemPrompt: true };
  }

  // eslint-disable-next-line require-yield
  async *chat(_input) {
    yield { kind: 'error', message: 'OpenAI provider is not yet implemented.' };
  }

  abort() {}
}

module.exports = { OpenAIProvider };
