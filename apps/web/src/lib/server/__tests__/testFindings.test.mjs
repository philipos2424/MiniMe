import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseModelJson } from '../modelJson.mjs';
import { heldContactsText } from '../ownerInbox.mjs';
import { productAddedText, captionWantsProduct } from '../ownerTeach.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');

test('model JSON: plain, fenced, and wrapped in prose', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here you go: {"a":[1,2]} hope it helps'), { a: [1, 2] });
  assert.throws(() => parseModelJson('no json here'));
});

test('held Secretary contacts are listed as waiting', () => {
  const now = Date.parse('2026-10-30T18:00:00Z');
  const t = heldContactsText({
    '1': { name: 'Contact A', text: 'can I order today?', at: '2026-10-30T17:00:00Z' },
    '2': { name: 'Contact B', text: 'hi', at: '2026-10-30T11:54:00Z' },
  }, { now });
  assert.match(t, /Waiting for you to say who they are \(2\)/);
  assert.ok(t.indexOf('Contact A') < t.indexOf('Contact B'), 'newest first');
  assert.match(t, /1h ago/);
  assert.equal(heldContactsText({}), '');
  assert.equal(heldContactsText(null), '');
});

test('inbox answer includes held contacts', () => {
  const src = read('../ownerCommands.js');
  assert.match(src, /heldContactsText\(prunePending\(business\.notification_prefs\?\.pending_contacts\)\)/);
});

test('the "add a picture" hint is a caption that actually adds the photo', () => {
  const t = productAddedText({ name: 'Test Item', price: 10, stock: null });
  const caption = t.match(/caption _(.+?)_/)[1];
  assert.equal(caption, 'Test Item 10 birr');
  assert.ok(captionWantsProduct(caption));
});

test('provider failures keep their reason', () => {
  const src = read('../openaiClient.js');
  assert.match(src, /error: `\$\{e\?\.status \|\| e\?\.code \|\| ''\} \$\{String\(e\?\.message \|\| e\)\}`/);
  assert.match(read('../llmCallLog.mjs'), /error: _err, \.\.\.base/);
  assert.match(read('../../../app/api/onboarding/offerings/route.js'), /parseModelJson\(res\.choices\[0\]\.message\.content\)/);
});
