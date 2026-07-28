import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldTryPersonal, pickToken, FAILURE_COOLDOWN_MS } from '../sendAsLogic.mjs';

const NOW = Date.parse('2026-07-25T09:00:00Z');

// ────────────────────────────── shouldTryPersonal ──────────────────────────────

test('prefer "bot" always short-circuits to false, regardless of everything else', () => {
  assert.equal(shouldTryPersonal({ prefer: 'bot', bizConnId: 'x', coverage: { chat_id: 1 }, nowMs: NOW }), false);
});

test('no business connection configured → never try personal', () => {
  assert.equal(shouldTryPersonal({ bizConnId: null, coverage: { chat_id: 1 }, nowMs: NOW }), false);
});

test('no proven coverage for this chat → never gamble a cold send', () => {
  assert.equal(shouldTryPersonal({ bizConnId: 'conn1', coverage: null, nowMs: NOW }), false);
});

test('proven coverage, no prior failure → try personal', () => {
  assert.equal(shouldTryPersonal({ bizConnId: 'conn1', coverage: { chat_id: 1 }, nowMs: NOW }), true);
});

test('recent failure within the cooldown → do not retry personal yet', () => {
  const recentFail = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago
  assert.equal(shouldTryPersonal({ bizConnId: 'conn1', coverage: { send_failed_at: recentFail }, nowMs: NOW }), false);
});

test('failure outside the cooldown window → willing to try again', () => {
  const oldFail = new Date(NOW - FAILURE_COOLDOWN_MS - 60000).toISOString();
  assert.equal(shouldTryPersonal({ bizConnId: 'conn1', coverage: { send_failed_at: oldFail }, nowMs: NOW }), true);
});

test('prefer "personal" does not override missing coverage — still no gamble', () => {
  assert.equal(shouldTryPersonal({ prefer: 'personal', bizConnId: 'conn1', coverage: null, nowMs: NOW }), false);
});

// ────────────────────────────── pickToken ──────────────────────────────

test('personal-identity sends always use the shared token, even if the tenant has their own bot', () => {
  assert.equal(pickToken('owner', { tenantToken: 'tenant-tok', sharedToken: 'shared-tok' }), 'shared-tok');
});

test('personal-identity send with no shared token configured → null (never fall back to tenant token)', () => {
  assert.equal(pickToken('owner', { tenantToken: 'tenant-tok', sharedToken: null }), null);
});

test('bot-identity sends prefer the tenant token when present', () => {
  assert.equal(pickToken('bot', { tenantToken: 'tenant-tok', sharedToken: 'shared-tok' }), 'tenant-tok');
});

test('bot-identity sends fall back to the shared token when the tenant has no bot', () => {
  assert.equal(pickToken('bot', { tenantToken: null, sharedToken: 'shared-tok' }), 'shared-tok');
});

test('no tokens available at all → null', () => {
  assert.equal(pickToken('bot', { tenantToken: null, sharedToken: null }), null);
});
