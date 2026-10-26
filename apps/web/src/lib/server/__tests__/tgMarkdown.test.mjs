import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTgMarkdown, stripTgMarkdown } from '../../tgMarkdown.mjs';

test('tg:// mentions render as the name, never the raw link', () => {
  assert.equal(stripTgMarkdown('Ask [Abebe](tg://user?id=123) about it'), 'Ask Abebe about it');
  assert.deepEqual(tokenizeTgMarkdown('[Abebe](tg://user?id=123)'), [{ type: 'text', text: 'Abebe' }]);
});

test('http links stay links', () => {
  assert.deepEqual(tokenizeTgMarkdown('[Shop](https://t.me/x)'), [{ type: 'link', text: 'Shop', href: 'https://t.me/x' }]);
});

test('bold, italic and code', () => {
  assert.deepEqual(tokenizeTgMarkdown('*Sales* up _a lot_ `today`'), [
    { type: 'bold', text: 'Sales' }, { type: 'text', text: ' up ' },
    { type: 'italic', text: 'a lot' }, { type: 'text', text: ' ' }, { type: 'code', text: 'today' },
  ]);
  assert.equal(stripTgMarkdown('**Hi** there'), 'Hi there');
});

test('snake_case and lone symbols are left alone', () => {
  assert.equal(stripTgMarkdown('use shop_code and order_id'), 'use shop_code and order_id');
  assert.equal(stripTgMarkdown('5 * 3 = 15'), '5 * 3 = 15');
});

test('MarkdownV2 escapes are removed', () => {
  assert.equal(stripTgMarkdown('Total: 1\\,500\\.00 ETB\\!'), 'Total: 1\\,500.00 ETB!');
});

test('no lookbehind in the pattern (older iOS webviews cannot parse it)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../tgMarkdown.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\(\?<[=!]/);
});
