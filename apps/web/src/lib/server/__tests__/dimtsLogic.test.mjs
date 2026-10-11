import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samePhone, signBody, verifySignature, parseSendRequest, phoneTail } from '../dimtsLogic.mjs';

test('samePhone matches international and national forms of one number', () => {
  assert.equal(samePhone('+251911223344', '251911223344'), true);
  assert.equal(samePhone('+251911223344', '0911223344'), true);
  assert.equal(samePhone('0911223344', '+251 91 122 3344'), true);
});

test('samePhone refuses different or too-short numbers', () => {
  assert.equal(samePhone('+251911223344', '+251911223345'), false);
  assert.equal(samePhone('+14155550100', '0911223344'), false);
  assert.equal(samePhone('1234', '1234'), false);
  assert.equal(samePhone('0911223344', '0911223344'), true);
  assert.equal(samePhone('0911223344', '0811223344'), false);
  assert.equal(samePhone(null, '+251911223344'), false);
});

test('phoneTail keeps the last seven digits', () => {
  assert.equal(phoneTail('+251 911 223 344'), '1223344');
});

test('a signature verifies, and a changed body, stale time or wrong secret does not', () => {
  const now = 1_790_000_000_000;
  const ts = String(now / 1000);
  const body = '{"a":1}';
  const signature = signBody('s3cret', 'msg_1', ts, body);
  assert.doesNotThrow(() => verifySignature({ body, id: 'msg_1', timestamp: ts, signature }, 's3cret', now));
  assert.throws(() => verifySignature({ body: '{"a":2}', id: 'msg_1', timestamp: ts, signature }, 's3cret', now));
  assert.throws(() => verifySignature({ body, id: 'msg_1', timestamp: ts, signature }, 'other', now));
  assert.throws(() => verifySignature({ body, id: 'msg_1', timestamp: ts, signature }, 's3cret', now + 600_000));
  assert.throws(() => verifySignature({ body, id: 'msg_1', timestamp: ts, signature }, '', now));
});

test('whsec_ secrets use the base64 key, like Dimts', () => {
  const secret = `whsec_${Buffer.from('k3y').toString('base64')}`;
  const signature = signBody(secret, 'i', '1', 'b');
  assert.equal(signature, signBody('k3y', 'i', '1', 'b'));
});

test('parseSendRequest accepts a valid request and rejects bad phones', () => {
  const ok = parseSendRequest({ send_id: 'x', user_id: 'u', phone: '+251911223344', request: 'price list', draft: 'Hi', language: 'am' });
  assert.equal(ok.language, 'am');
  assert.equal(ok.caller_name, '');
  assert.throws(() => parseSendRequest({ send_id: 'x', user_id: 'u', phone: '0911', request: 'r', draft: 'd' }));
  assert.throws(() => parseSendRequest({ send_id: 'x', user_id: 'u', phone: '+251911223344', request: 'r' }));
  assert.equal(parseSendRequest({ send_id: 'x', user_id: 'u', phone: '+251911223344', request: 'r', draft: 'd', language: 'fr' }).language, 'en');
});
