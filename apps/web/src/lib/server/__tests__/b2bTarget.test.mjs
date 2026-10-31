import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shopCodeFrom, parseTargetRef, contactHint } from '../b2bTarget.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');

test('owners can name a business by number, name, @username or shop code', () => {
  assert.deepEqual(parseTargetRef('#2'), { kind: 'index', index: 2 });
  assert.deepEqual(parseTargetRef('3'), { kind: 'index', index: 3 });
  assert.deepEqual(parseTargetRef('number 4'), { kind: 'index', index: 4 });
  assert.deepEqual(parseTargetRef('2nd'), { kind: 'index', index: 2 });
  assert.equal(parseTargetRef('@YOTEXADVERT_bot').kind, 'handle');
  assert.equal(parseTargetRef('shop_0b70f6ec').kind, 'handle');
  assert.deepEqual(parseTargetRef('"Habsha"'), { kind: 'name', value: 'Habsha' });
  assert.equal(parseTargetRef(''), null);
});

test('shop codes are read from a code, shop_ prefix, or link', () => {
  assert.equal(shopCodeFrom('0b70f6ec'), '0b70f6ec');
  assert.equal(shopCodeFrom('shop_0B70F6EC'), '0b70f6ec');
  assert.equal(shopCodeFrom('https://t.me/MiniMeAgentBot?start=shop_0b70f6ec'), '0b70f6ec');
  assert.equal(shopCodeFrom('Habsha'), null);
});

test('every listed business shows how to reach it', () => {
  assert.equal(contactHint({ telegram_bot_username: 'x_bot', shop_code: 'abc' }), '@x_bot');
  assert.equal(contactHint({ shop_code: '0b70f6ec' }), 'code 0b70f6ec');
  assert.equal(contactHint({}), '');
});

test('list is numbered and remembered; connect and message resolve any reference', () => {
  const oc = read('../ownerCommands.js');
  assert.match(oc, /last_browse: \{ ids: results\.map\(r => r\.id\)/);
  assert.match(oc, /`\$\{i \+ 1\}\. \*\$\{plainForEntity\(biz\.name\)\}\*/);
  assert.equal((oc.match(/resolveBusinessTarget\((business|senderBiz), /g) || []).length, 2);
  const b2b = read('../b2b.js');
  assert.match(b2b, /export async function resolveBusinessTarget/);
  assert.match(b2b, /eq\('shop_code', code\)/);
});
