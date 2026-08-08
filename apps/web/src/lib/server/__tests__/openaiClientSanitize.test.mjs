import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForRealOpenAI } from '../openaiClient.js';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'reply_to_client',
    description: 'Send a message.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
}];

// The exact 400 this guards against, verified against the live API:
//   "Function tools with reasoning_effort are not supported for gpt-5.5 in
//    /v1/chat/completions. To use function tools, use /v1/responses or set
//    reasoning_effort to 'none'."
// Every agent-brain call carried both, so every one of them 400'd, fell through
// the provider chain, and landed on the canned-greeting fallback.
test('function tools force reasoning_effort to none — the API rejects any other pairing', () => {
  const clean = sanitizeForRealOpenAI(
    { messages: [], tools: TOOLS, tool_choice: 'auto', reasoning_effort: 'low', max_completion_tokens: 2000 },
    'gpt-5.5',
  );
  assert.equal(clean.reasoning_effort, 'none');
  assert.deepEqual(clean.tools, TOOLS, 'the tools themselves must survive — they are the point of the call');
  assert.equal(clean.tool_choice, 'auto');
});

test('an empty tools array is not a tool call — reasoning stays as asked', () => {
  const clean = sanitizeForRealOpenAI(
    { messages: [], tools: [], reasoning_effort: 'low', max_completion_tokens: 2000 },
    'gpt-5.5',
  );
  assert.equal(clean.reasoning_effort, 'low');
});

test('without tools, an explicit reasoning_effort is still honoured', () => {
  const clean = sanitizeForRealOpenAI(
    { messages: [], reasoning_effort: 'low', max_completion_tokens: 300 },
    'gpt-5.5',
  );
  assert.equal(clean.reasoning_effort, 'low');
  // Reasoning on: the 2000 floor still applies so hidden tokens can't starve
  // the visible answer.
  assert.equal(clean.max_completion_tokens, 2000);
});

test('tool calls keep their own token ceiling — the 2000 floor is a reasoning-only rule', () => {
  const clean = sanitizeForRealOpenAI(
    { messages: [], tools: TOOLS, reasoning_effort: 'low', max_completion_tokens: 500 },
    'gpt-5.5',
  );
  assert.equal(clean.reasoning_effort, 'none');
  assert.equal(clean.max_completion_tokens, 500);
});

test('non-gpt-5 models are left alone', () => {
  const clean = sanitizeForRealOpenAI(
    { messages: [], tools: TOOLS, reasoning_effort: 'low' },
    'gemini-2.5-flash',
  );
  assert.equal(clean.reasoning_effort, 'low');
});
