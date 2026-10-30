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
