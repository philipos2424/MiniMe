/**
 * Secretary replies run inside runWithBizConn, so tg() adds the business
 * connection id to every send. An owner alert raised mid-reply (the
 * "new customer" ping) then went out AS the owner INTO the owner's own chat
 * and Telegram refused it: "messages must not be sent to self". Sends to the
 * connection's owner must go out as a plain bot DM; customer sends keep it.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tg, tgSendDocument, runWithBizConn, setBizConnOwner, setBizConnId, clearBizConnId } from '../telegramApi.js';

const OWNER = 111;
const CUSTOMER = 222;
const CONN = 'conn-abc';
let sent;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: init.body });
    return { json: async () => ({ ok: true, result: {} }) };
  };
  setBizConnOwner(CONN, OWNER, 'biz-1');
});
afterEach(() => { globalThis.fetch = realFetch; clearBizConnId(CUSTOMER); clearBizConnId(OWNER); });

test('owner alert inside a business-connection reply is a plain bot DM', async () => {
  await runWithBizConn(CONN, () => tg('T', 'sendMessage', { chat_id: OWNER, text: 'New customer' }));
  assert.equal(JSON.parse(sent[0].body).business_connection_id, undefined);
});

test('customer reply inside the same context still carries the connection', async () => {
  await runWithBizConn(CONN, () => tg('T', 'sendMessage', { chat_id: CUSTOMER, text: 'hi' }));
  assert.equal(JSON.parse(sent[0].body).business_connection_id, CONN);
});

test('owner chat id given as a string still matches', async () => {
  await runWithBizConn(CONN, () => tg('T', 'sendMessage', { chat_id: String(OWNER), text: 'x' }));
  assert.equal(JSON.parse(sent[0].body).business_connection_id, undefined);
});

test('legacy chat map path skips the owner too', async () => {
  setBizConnId(OWNER, CONN);
  setBizConnId(CUSTOMER, CONN);
  await tg('T', 'sendMessage', { chat_id: OWNER, text: 'a' });
  await tg('T', 'sendMessage', { chat_id: CUSTOMER, text: 'b' });
  assert.equal(JSON.parse(sent[0].body).business_connection_id, undefined);
  assert.equal(JSON.parse(sent[1].body).business_connection_id, CONN);
});

test('multipart sendDocument follows the same rule', async () => {
  await runWithBizConn(CONN, () => tgSendDocument('T', OWNER, Buffer.from('x'), 'a.pdf'));
  await runWithBizConn(CONN, () => tgSendDocument('T', CUSTOMER, Buffer.from('x'), 'a.pdf'));
  assert.equal(sent[0].body.get('business_connection_id'), null);
  assert.equal(sent[1].body.get('business_connection_id'), CONN);
});

test('an explicit business_connection_id is never stripped', async () => {
  await tg('T', 'sendMessage', { chat_id: OWNER, text: 'x', business_connection_id: 'explicit' });
  assert.equal(JSON.parse(sent[0].body).business_connection_id, 'explicit');
});
