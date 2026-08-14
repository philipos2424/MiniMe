import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, groundReport, extractQuoteFacts } from '../researchTruth.mjs';

const campaign = { id: 'camp-1', target_ids: ['biz-1', 'biz-2'] };
const targets = [
  { id: 'biz-1', name: 'Real Supplier One', telegram_bot_username: 'realsupplier1' },
  { id: 'biz-2', name: 'Real Supplier Two', telegram_bot_username: 'realsupplier2' },
];

test('buildLedger only admits messages from businesses in target_ids', () => {
  const messages = [
    { id: 'm1', sender_id: 'biz-1', content: '28000 ETB, 5 day lead time', created_at: '2026-08-01' },
    { id: 'm2', sender_id: 'not-a-target', content: 'irrelevant', created_at: '2026-08-01' },
  ];
  const ledger = buildLedger({ campaign, targets, messages });
  assert.equal(ledger.totalCount, 2);
  assert.equal(ledger.respondedCount, 1);
  assert.equal(ledger.byId.get('biz-1').responded, true);
  assert.equal(ledger.byId.get('biz-1').messages.length, 1);
  assert.equal(ledger.byId.get('biz-2').responded, false);
});

test('zero replies produces zero comparison rows — the fix for the 73-of-81 bug', () => {
  const ledger = buildLedger({ campaign, targets, messages: [] });
  const report = groundReport(
    { comparison: [{ candidate_id: 'ghost', name: 'Supplier C', price: 28000 }] },
    ledger,
  );
  assert.deepEqual(report.comparison, []);
  assert.equal(report.recommendation, null);
  assert.equal(report.no_replies, true);
  assert.match(report.summary_line, /No replies yet/);
});

test('a fabricated candidate_id not in target_ids never reaches the report', () => {
  const messages = [
    { id: 'm1', sender_id: 'biz-1', content: 'yes 28000 ETB', created_at: '2026-08-01' },
  ];
  const ledger = buildLedger({ campaign, targets, messages });
  const model = {
    comparison: [
      { candidate_id: 'biz-1', name: 'Model-Renamed Supplier', price: 28000, price_source_message_id: 'm1' },
      { candidate_id: 'SupplierC', name: 'Supplier C', price: 25000 }, // invented, not in ledger
    ],
    recommendation: { winner_id: 'SupplierC', winner_name: 'Supplier C', winner_username: 'SupplierC' },
  };
  const report = groundReport(model, ledger);
  // One row per real ledger entry (biz-1 responded, biz-2 didn't) — the
  // fabricated "SupplierC" row never makes it in, however the model framed it.
  assert.equal(report.comparison.length, 2);
  assert.ok(!report.comparison.some(c => c.name === 'Supplier C'));
  const row1 = report.comparison.find(c => c.candidate_id === 'biz-1');
  // Identity always comes from the DB row, never the model's text.
  assert.equal(row1.name, 'Real Supplier One');
  assert.equal(row1.username, 'realsupplier1');
  // Recommendation can't point at a fabricated winner not in the ledger.
  assert.equal(report.recommendation, null);
});

test('a factual claim with no matching source_message_id is stripped, not trusted', () => {
  const messages = [
    { id: 'm1', sender_id: 'biz-1', content: 'hi', created_at: '2026-08-01' },
  ];
  const ledger = buildLedger({ campaign, targets, messages });
  const model = {
    comparison: [
      { candidate_id: 'biz-1', price: 28000 }, // no price_source_message_id at all
    ],
  };
  const report = groundReport(model, ledger);
  assert.equal(report.comparison[0].price, null);
});

test('a factual claim citing a real message id from this business survives', () => {
  const messages = [
    { id: 'm1', sender_id: 'biz-1', content: '28000 ETB, 5 day lead time', created_at: '2026-08-01' },
  ];
  const ledger = buildLedger({ campaign, targets, messages });
  const model = {
    comparison: [
      { candidate_id: 'biz-1', price: 28000, price_source_message_id: 'm1' },
    ],
  };
  const report = groundReport(model, ledger);
  assert.equal(report.comparison[0].price, 28000);
  assert.equal(report.comparison[0].price_source_message_id, 'm1');
});

test('a factual claim citing a message id from a DIFFERENT business is stripped', () => {
  const messages = [
    { id: 'm1', sender_id: 'biz-1', content: 'ours', created_at: '2026-08-01' },
    { id: 'm2', sender_id: 'biz-2', content: '99999 ETB', created_at: '2026-08-01' },
  ];
  const ledger = buildLedger({ campaign, targets, messages });
  const model = {
    comparison: [
      // biz-1's row tries to cite biz-2's message — cross-business smuggling.
      { candidate_id: 'biz-1', price: 99999, price_source_message_id: 'm2' },
    ],
  };
  const report = groundReport(model, ledger);
  assert.equal(report.comparison[0].price, null);
});

test('extractQuoteFacts pulls price and lead time only when the text actually says them', () => {
  const facts = extractQuoteFacts('28000 ETB, 5 day lead time');
  assert.equal(facts.price, 28000);
  assert.equal(facts.lead_time, '5 day');
  assert.equal(facts.source_quote, '28000 ETB, 5 day lead time');
});

test('extractQuoteFacts does not read a bare number as a price', () => {
  const facts = extractQuoteFacts('we can do it in 5 days');
  assert.equal(facts.price, undefined);
  assert.equal(facts.lead_time, '5 days');
});

test('extractQuoteFacts handles "k" shorthand', () => {
  const facts = extractQuoteFacts('around 25k birr for the whole order');
  assert.equal(facts.price, 25000);
});

test('non-responders get no opinion fields, just an honest note', () => {
  const messages = [
    { id: 'm1', sender_id: 'biz-1', content: 'hi', created_at: '2026-08-01' },
  ];
  const ledger = buildLedger({ campaign, targets, messages });
  const report = groundReport({ comparison: [] }, ledger);
  const nonResponder = report.comparison.find(c => c.candidate_id === 'biz-2');
  assert.equal(nonResponder.responded, false);
  assert.equal(nonResponder.note, 'No reply received.');
  assert.deepEqual(nonResponder.pros, []);
});
