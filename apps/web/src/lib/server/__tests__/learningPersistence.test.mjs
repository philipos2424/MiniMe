import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CURRENCIES } from '../../onboarding-config.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function body(file, name, end) {
  const src = read(file);
  return src.slice(src.indexOf(`export async function ${name}(`), end ? src.indexOf(end) : undefined).replace('export async function', 'async function');
}
const briefCode = body('teaching.js', 'saveBusinessBrief', 'export async function saveClientFacts(');
const faqCode = body('replyEngine.js', 'saveFaqPair', 'export async function learnFromOwnerReply(');

function storage(fail = '') {
  const writes = [];
  return { writes, from(table) {
    let op = 'select', value;
    const q = {
      select() { return q; }, single() { return q; }, eq() { return q; },
      insert(v) { op = 'insert'; value = v; return q; },
      update(v) { op = 'update'; value = v; return q; },
      delete() { op = 'delete'; return q; },
      then(resolve, reject) {
        if (op !== 'select') writes.push({ table, op, value });
        const key = `${table}:${op}${value?.status ? ':' + value.status : ''}`;
        return Promise.resolve({ error: key === fail ? { message: 'storage failure' } : null,
          data: table === 'documents' ? (op === 'select' ? [] : { id: 'doc' }) : { owner_instructions: [{ source: 'manual', text: 'Keep me' }] },
        }).then(resolve, reject);
      },
    };
    return q;
  } };
}

test('knowledge storage reports embedding/ready-write failures and succeeds only after storage', async () => {
  for (const fail of ['embedding', 'documents:update:ready', 'documents:insert:embedding', '']) {
    const db = storage(fail);
    const save = new Function('supabase', 'chunkText', 'embedOne', 'canonicalCategory', briefCode + '; return saveBusinessBrief;')(
      () => db, text => [text], async () => { if (fail === 'embedding') throw new Error('embedding unavailable'); return [0.1]; }, value => value,
    );
    const result = await save('shop', { text: 'Delivery is available.', extracted: null });
    assert.equal(result.ok, !fail);
    if (fail === 'embedding') assert.ok(!db.writes.some(w => w.value?.status === 'ready'));
    if (!fail) assert.deepEqual(db.writes.map(w => w.table), ['documents', 'document_chunks', 'documents']);
  }
});

test('failed FAQ reads never overwrite existing instructions; successful writes preserve them', async () => {
  for (const fail of ['businesses:select', '']) {
    const db = storage(fail);
    let embedded = false;
    const save = new Function('supabase', 'saveLessonAsDocument', faqCode + '; return saveFaqPair;')(() => db, async () => { embedded = true; });
    if (fail) {
      await assert.rejects(save('shop', 'Delivery?', 'Two days'), /Could not load/);
      assert.equal(db.writes.length, 0);
      assert.equal(embedded, false);
    } else {
      const saved = await save('shop', 'Delivery?', 'Two days');
      assert.equal(saved[0].text, 'Keep me');
      assert.equal(saved[1].answer, 'Two days');
      assert.equal(embedded, true);
    }
  }
});

test('semantic lesson storage never marks failed chunks ready and cleans up incomplete documents', async () => {
  const code = body('autoLearn.js', 'saveLessonAsDocument');
  for (const fail of ['document_chunks:insert', 'documents:update:ready', '']) {
    const db = storage(fail);
    const save = new Function('supabase', 'fingerprint', 'embedOne', code + '; return saveLessonAsDocument;')(() => db, () => 'fingerprint', async () => [0.1]);
    await save('shop', 'Delivery time?', 'Within two days');
    if (fail === 'document_chunks:insert') assert.ok(!db.writes.some(w => w.value?.status === 'ready'));
    assert.equal(db.writes.some(w => w.op === 'delete'), !!fail);
  }
});

test('failed brief stops catalog mutations and preserves the failure result', async () => {
  const code = body('teaching.js', 'teachFromText', 'export async function extractProductsFromText(');
  let extractedProducts = false;
  const teach = new Function('extractBusinessFacts', 'saveBusinessBrief', 'extractProductsFromText', code + '; return teachFromText;')(
    async () => ({}), async () => ({ ok: false, error: 'Try again' }), async () => { extractedProducts = true; return []; },
  );
  assert.equal((await teach('shop', 'Repair KES 250')).ok, false);
  assert.equal(extractedProducts, false);
});

test('catalog accepts currency before/after prices, preserves amount, and retains the cheap no-price gate', async () => {
  const code = body('teaching.js', 'extractProductsFromText', 'export async function extractProductFromMessage(');
  let calls = 0;
  const client = { chat: { completions: { create: async () => {
    calls++;
    return { choices: [{ message: { content: JSON.stringify({ products: [
      { name: 'Repair', price: 250, currency: 'kes' }, { name: 'Planter', price: 400, currency: 'INR' },
    ] }) } }] };
  } } } };
  const extract = new Function('openai', 'MODEL_MINI', 'CURRENCIES', code + '; return extractProductsFromText;')(client, 'fixture', CURRENCIES);
  for (const input of ['Repair KES 250', 'Planter 400 INR', 'Repair $250', 'Repair 250 birr']) {
    const products = await extract(input);
    assert.equal(products[0].currency, 'KES');
    assert.equal(products[0].price, 250);
    assert.equal(products[1].currency, 'INR');
  }
  assert.deepEqual(await extract('Welcome to our shop'), []);
  assert.equal(calls, 4);
});
