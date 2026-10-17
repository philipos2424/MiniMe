import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyMarkdownOk, plainText, withoutMarkdown, isParseError, inBold, inItalic } from '../telegramMarkdown.mjs';
import { notifyOwnerDraft } from '../notification.js';

test('legacyMarkdownOk mirrors Telegram: unclosed entities fail, escapes outside entities pass', () => {
  assert.equal(legacyMarkdownOk('*bold* _it_ `c`'), true);
  assert.equal(legacyMarkdownOk('price 2*3 shirts'), false);
  assert.equal(legacyMarkdownOk('t.me/MiniMeAgentBot?start=shop_abc'), false);
  assert.equal(legacyMarkdownOk('t.me/MiniMeAgentBot?start=shop\\_abc'), true);
  assert.equal(legacyMarkdownOk(`*${inBold('A*B')}* _${inItalic('x_y')}_`), true);
});

test('withoutMarkdown drops parse_mode and markup, keeps everything else', () => {
  const body = { chat_id: 1, text: '*Hi* 2*3 \\_x', parse_mode: 'Markdown', reply_markup: { a: 1 } };
  assert.deepEqual(withoutMarkdown(body), { chat_id: 1, text: 'Hi 23 _x', reply_markup: { a: 1 } });
  assert.deepEqual(withoutMarkdown({ photo: 'p', caption: '_c', parse_mode: 'Markdown' }), { photo: 'p', caption: 'c' });
  assert.equal(plainText(undefined), '');
  assert.equal(isParseError({ description: "Bad Request: can't parse entities: Can't find end of the entity" }), true);
  assert.equal(isParseError({ description: 'Forbidden: bot was blocked by the user' }), false);
});

test("owner draft card still arrives when the customer's text breaks Markdown", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const ok = !body.parse_mode;
    return { json: async () => (ok ? { ok: true, result: {} } : { ok: false, description: "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 40" }) };
  };
  try {
    await notifyOwnerDraft('TOKEN', { owner_telegram_id: 7, name: 'Shop' }, { name: 'Abebe' }, 'I want 2*3 shirts', 'Sure!', 0.9, 'draft-1', null, null, null);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].parse_mode, 'Markdown');
  assert.equal(calls[1].parse_mode, undefined);
  assert.match(calls[1].text, /I want 23 shirts/);
  assert.deepEqual(calls[1].reply_markup, calls[0].reply_markup); // Approve/Edit buttons survive
});
