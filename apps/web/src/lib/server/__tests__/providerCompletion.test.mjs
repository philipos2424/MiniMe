import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the real fallback loop without provider requests or telemetry writes.
const source = readFileSync(new URL('../openaiClient.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '')
  .replace(/^export /gm, '');
const loadClient = new Function('OpenAI', 'logCall', 'inferRoute', 'estimateCost', 'process',
  source + '\nreturn makeOpenAI;');

function fixture(firstResponse) {
  const calls = [];
  const logs = [];
  const fallback = { choices: [{ message: { content: 'Fallback answer' } }] };
  class MockOpenAI {
    constructor(options) {
      this.chat = { completions: { create: async () => {
        calls.push(options.baseURL);
        return calls.length === 1 ? firstResponse : fallback;
      } } };
    }
  }
  const makeClient = loadClient(MockOpenAI, entry => logs.push(entry), () => 'test', () => 0, {
    env: { GEMINI_API_KEY: 'test', GROQ_API_KEY: 'test' },
  });
  return { client: makeClient(), calls, logs, fallback };
}

for (const content of [null, '', undefined]) {
  test('tool calls survive fallback validation with content=' + String(content), async () => {
    const response = { choices: [{ message: { content, tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'reply_to_client', arguments: '{}' } },
    ] } }] };
    const { client, calls, logs } = fixture(response);
    assert.equal(await client.chat.completions.create({ model: 'test', messages: [] }), response);
    assert.equal(calls.length, 1);
    assert.deepEqual(logs.map(entry => entry.ok), [true]);
  });
}

for (const response of [
  { choices: [{ message: { content: null, tool_calls: [] } }] },
  { choices: [{ message: { content: '   ' } }] },
  { choices: [] },
  {},
]) {
  test('unusable completion falls through: ' + JSON.stringify(response), async () => {
    const { client, calls, logs, fallback } = fixture(response);
    assert.equal(await client.chat.completions.create({ model: 'test', messages: [] }), fallback);
    assert.equal(calls.length, 2);
    assert.deepEqual(logs.map(entry => entry.ok), [false, true]);
  });
}

test('a normal text answer returns without fallback', async () => {
  const response = { choices: [{ message: { content: 'Hello' } }] };
  const { client, calls, logs } = fixture(response);
  assert.equal(await client.chat.completions.create({ model: 'test', messages: [] }), response);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs.map(entry => entry.ok), [true]);
});
