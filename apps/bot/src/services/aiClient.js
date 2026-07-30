const OpenAI = require('openai');

/**
 * Shared AI Client for Telegram Bot Services.
 *
 * Automatically routes to Ollama (http://127.0.0.1:11434/v1) or OpenAI depending on .env settings.
 * Handles model mapping so gpt-4o / gpt-4o-mini translate to local Ollama models (e.g. qwen2.5:0.5b).
 */
const useOllama = process.env.USE_OLLAMA === 'true' || process.env.OLLAMA_ENABLED === 'true' || (process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('11434'));
const baseURL = process.env.OPENAI_BASE_URL || (useOllama ? 'http://127.0.0.1:11434/v1' : undefined);
const apiKey = process.env.OPENAI_API_KEY || 'ollama';
const defaultOllamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: baseURL,
  timeout: 60_000,
  maxRetries: 2,
});

function resolveModel(requestedModel) {
  if (useOllama) {
    return defaultOllamaModel;
  }
  return requestedModel || 'gpt-4o-mini';
}

module.exports = {
  openai,
  resolveModel,
  useOllama,
};
