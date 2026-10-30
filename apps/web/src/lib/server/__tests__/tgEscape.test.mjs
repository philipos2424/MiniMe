import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escapeLegacyMd, stripMd } from '../tgEscape.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');

test('legacy Markdown escape touches only _ * ` [', () => {
  assert.equal(escapeLegacyMd('YOTEX (@YOTEX_bot) · yotex@gmail.com'), 'YOTEX (@YOTEX\\_bot) · yotex@gmail.com');
  assert.equal(escapeLegacyMd('*50% off* [today]'), '\\*50% off\\* \\[today]');
  assert.equal(escapeLegacyMd(null), '');
});

test('stripMd gives a clean plain-text fallback', () => {
  assert.equal(stripMd('*Hi* \\_x\\_ gmail\\.com'), 'Hi _x_ gmail.com'.replace(/_/g, ''));
});

test('no MarkdownV2-style escaper is left in files that send legacy Markdown', () => {
  for (const f of ['../research.js', '../b2b.js', '../ownerCommands.js', '../../../app/api/cron/b2b-follow-up/route.js', '../../../app/api/cron/research-timeout/route.js', '../replyEngine.js']) {
    assert.doesNotMatch(read(f), /\[_\*\\?\[\\?\]\(\)~`>#\+/, f);
  }
});

test('partner messages: content escaped, delivered only when Telegram accepted it', () => {
  const b2b = read('../b2b.js');
  assert.match(b2b, /escapeMd\(truncate\(row\.content, 500\)\)/);
  assert.match(b2b, /if \(!sent\?\.ok\) \{\s*console\.warn\('\[b2b\] inbound not delivered:'/);
  assert.match(b2b, /stripMd\(text\)/);
});

test('text inside bold/italic drops Markdown characters instead of escaping', async () => {
  const { plainForEntity } = await import('../tgEscape.mjs');
  assert.equal(plainForEntity('Abudi_shirts *x* [y]'), 'Abudi shirts x y');
});

test('sendMarkdownSafe resends as plain text when Telegram cannot parse', async () => {
  const { sendMarkdownSafe } = await import('../tgEscape.mjs');
  const calls = [];
  const send = async b => { calls.push(b); return calls.length === 1 ? { ok: false, description: "Bad Request: can't parse entities" } : { ok: true }; };
  const r = await sendMarkdownSafe(send, { chat_id: 1, text: '*Hi* \\_there', parse_mode: 'Markdown' });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].parse_mode, undefined);
  assert.equal(calls[1].text, 'Hi there');
  const calls2 = [];
  await sendMarkdownSafe(async b => { calls2.push(b); return { ok: false, description: 'Forbidden' }; }, { chat_id: 1, text: 'x', parse_mode: 'Markdown' });
  assert.equal(calls2.length, 1, 'other errors are not retried');
});

test('owner-agent answers and the business list use the safe paths', () => {
  const oc = read('../ownerCommands.js');
  assert.equal((oc.match(/sendMarkdownSafe\(b => tg\(token, 'sendMessage', b\)/g) || []).length, 2);
  assert.match(oc, /\*\$\{plainForEntity\(biz\.name\)\}\*/);
});
