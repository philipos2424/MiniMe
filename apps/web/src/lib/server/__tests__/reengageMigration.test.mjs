import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const sql = readFileSync(`${root}packages/db/migrations/045_reengagement_sends.sql`, 'utf8');

test('table is created idempotently', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS reengagement_sends/);
});

test('every column the engine writes exists', () => {
  for (const col of ['telegram_id', 'business_id', 'stage', 'variant', 'sent_at', 'replied_at', 'exit_reason', 'outcome']) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});

test('business_id is UUID to match businesses.id', () => {
  assert.match(sql, /business_id\s+UUID/i);
});

test('lookups by recipient and recency are indexed', () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[\s\S]*telegram_id/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[\s\S]*sent_at/i);
});
