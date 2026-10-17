import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Gemini rejects a request with no user turn; OpenAI and Groq accept it. The
// brain sent a system-only request for months and every turn fell to Groq.
test('the agent brain sends the customer turn as a user message', () => {
  const src = readFileSync(new URL('../agentBrain.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /const messages = \[\{ role: 'system', content: system \}\];/,
    'a system-only message array fails on Gemini');
  assert.match(src, /\{ role: 'user', content: `Customer: """\$\{inboundText\}"""/);
});
