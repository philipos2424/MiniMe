import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileService, exactPhone, parseFileRequest } from '../dimtsFiles.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const rows = new Map(); let sends = 0;
  const business = { id: id(1) };
  const customer = { id: id(2), name: 'Customer', phone: '+15555550123', telegram_id: 55 };
  const document = { id: id(3), enabled: true, status: 'ready', storage_path: 'owned/file', original_filename: 'prices.pdf' };
  const state = { bytes: Buffer.from('approved file'), customer, document, linked: true, result: { ok: true, result: { message_id: 123 } } };
  const io = {
    business: async user => state.linked && user === 'owner' ? business : null,
    customers: async () => [customer], documents: async () => [document],
    customer: async (_b, key) => key === customer.id ? customer : null,
    document: async (_b, key) => key === document.id ? document : null,
    download: async () => state.bytes, preview: async () => 'https://example.test/short-lived',
    prior: async (b, key) => rows.get(key)?.business_id === b ? rows.get(key) : null,
    claim: async row => { if (rows.has(row.send_id)) return false; rows.set(row.send_id, { ...row }); return true; },
    finish: async (_b, key, outcome) => Object.assign(rows.get(key), outcome),
    send: async () => { sends++; if (state.hold) await state.hold; if (state.throw) throw new Error('timeout'); return state.result; },
  };
  const handle = createFileService(io);
  const req = { user_id: 'owner', phone: customer.phone, document_id: document.id, customer_id: customer.id, caption: 'As requested' };
  const prepare = () => handle({ ...req, operation: 'prepare' });
  const send = async (approval, changes = {}) => handle({ ...req, operation: 'send', send_id: id(9), approval_hash: approval.approval_hash, ...changes });
  return { state, handle, req, prepare, send, rows, sends: () => sends };
}
test('review sends nothing; repeated and simultaneous approvals send exactly once with receipt', async () => {
  const f = fixture(), approval = await f.prepare();
  assert.equal(f.sends(), 0); assert.equal(approval.file.name, 'prices.pdf');
  const results = await Promise.all([f.send(approval), f.send(approval)]);
  assert.equal(f.sends(), 1);
  assert.ok(results.some(r => r.status === 'sent'));
  assert.equal((await f.send(approval)).message_id, 123);
  assert.equal((await f.handle({ operation: 'status', user_id: 'owner', send_id: id(9) })).status, 'sent');
});
test('changed bytes, destination, caption or identity invalidate review before sending', async () => {
  for (const change of ['bytes','chat','caption','file','owner']) {
    const f = fixture(), approval = await f.prepare();
    const over = {};
    if (change === 'bytes') f.state.bytes = Buffer.from('replacement');
    if (change === 'chat') f.state.customer.telegram_id = 99;
    if (change === 'caption') over.caption = 'changed';
    if (change === 'file') over.document_id = id(99);
    if (change === 'owner') over.user_id = 'other-owner';
    await assert.rejects(f.send(approval, over)); assert.equal(f.sends(), 0);
  }
});
test('a lost response remains unknown and a repeated send never transmits again', async () => {
  const f = fixture(), approval = await f.prepare(); f.state.throw = true;
  assert.equal((await f.send(approval)).status, 'unknown');
  assert.equal((await f.send(approval)).status, 'unknown'); assert.equal(f.sends(), 1);
});
test('rejection is failed, missing receipt is unknown, and payload changes cannot reuse execution id', async () => {
  for (const [result, expected] of [[{ ok: false }, 'failed'], [{ ok: true }, 'unknown']]) {
    const f = fixture(), approval = await f.prepare(); f.state.result = result;
    assert.equal((await f.send(approval)).status, expected);
    await assert.rejects(f.send(approval, { caption: 'another message' }), /execution_changed/);
    assert.equal(f.sends(), 1);
  }
});
test('missing link/file/recipient and a disabled file never send', async () => {
  for (const change of ['link', 'enabled', 'phone']) {
    const f = fixture(), approval = await f.prepare();
    if (change === 'link') f.state.linked = false;
    if (change === 'enabled') f.state.document.enabled = false;
    if (change === 'phone') f.state.customer.phone = '+441555550123';
    await assert.rejects(f.send(approval)); assert.equal(f.sends(), 0);
  }
});
test('international numbers must match exactly; malformed operations fail closed', () => {
  assert.equal(exactPhone('+1 (555) 555-0123', '+15555550123'), true);
  assert.equal(exactPhone('05555550123', '+15555550123'), false);
  assert.throws(() => parseFileRequest({ operation: 'send' }));
  assert.throws(() => parseFileRequest({ operation: 'auto-send', user_id: 'owner' }));
});
