// Smoke-test the teaching pipeline end-to-end against the live DB.
// 1) Picks the first business
// 2) Teaches a description
// 3) Teaches a forwarded client snippet
// 4) Reads back what landed in documents / document_chunks / customer_memory
// 5) Hits retrieveRelevantChunks to confirm retrieval works

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.test', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\n$/, '')]; })
);

process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

async function extractBusinessFacts(text) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `Extract business facts as JSON: {category, location, services, specialties, client_types, price_range:{min,max,currency}, turnaround, tone, summary}. Null if absent.` },
      { role: 'user', content: text },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

async function extractFromClientMessage(text) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `Extract from client message JSON: {client_name, sentiment, facts:[], project_type, budget_hint, deadline_hint, summary}` },
      { role: 'user', content: text },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

async function embed(text) {
  const r = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
  return r.data[0].embedding;
}

const { data: businesses } = await sb.from('businesses').select('id, name').limit(1);
if (!businesses?.length) { console.error('no business in DB'); process.exit(1); }
const biz = businesses[0];
console.log('Test business:', biz.name, biz.id);

// ── TEST 1: Teach a description ──
console.log('\n[1/3] Teaching a business description...');
const desc = "I'm a graphic designer in Addis specializing in branding and social media. I do logos for 5,000–12,000 ETB and full brand packages 25,000–60,000 ETB. Most clients are NGOs, startups, and small cafés. I deliver in 4–7 days. Tone: warm and modern.";
const facts = await extractBusinessFacts(desc);
console.log('  Extracted:', JSON.stringify(facts, null, 2));
const { data: doc } = await sb.from('documents').insert({
  business_id: biz.id,
  title: 'Owner brief — test',
  tag: 'business-brief',
  description: desc.slice(0, 400),
  mime_type: 'text/plain',
  original_filename: 'owner-brief-test.txt',
  status: 'embedding',
  meta: { source: 'teaching-test', summary: facts.summary },
}).select().single();
console.log('  Document ID:', doc.id);
const embedding = await embed(desc);
await sb.from('document_chunks').insert([{
  document_id: doc.id, business_id: biz.id, chunk_index: 0,
  content: desc, token_count: Math.ceil(desc.length / 4), embedding,
}]);
await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);
console.log('  ✓ Saved & embedded');

// ── TEST 2: Forwarded client snippet ──
console.log('\n[2/3] Extracting from a forwarded client snippet...');
const snippet = "Sara Haile: Hi! Thank you so much for the cards last month — they were perfect. I have a wedding April 20 and need 200 invitations and seating cards. Budget around 8,000 ETB. Can you do it?";
const clientFacts = await extractFromClientMessage(snippet);
console.log('  Extracted:', JSON.stringify(clientFacts, null, 2));
const noteRows = (clientFacts.facts || []).slice(0, 6).map(f => ({
  business_id: biz.id, customer_id: null, kind: 'fact', content: f, source: 'forwarded-test',
}));
if (clientFacts.sentiment) noteRows.push({
  business_id: biz.id, customer_id: null, kind: 'note',
  content: `Sentiment: ${clientFacts.sentiment} — ${clientFacts.summary || ''}`, source: 'forwarded-test',
});
console.log('  Facts to store:', noteRows.length);
// store as orphan doc
const orphanText = noteRows.map(r => `- [${r.kind}] ${r.content}`).join('\n');
const { data: odoc } = await sb.from('documents').insert({
  business_id: biz.id,
  title: `Forwarded client notes — test`,
  tag: 'forwarded-notes',
  description: orphanText.slice(0, 400),
  mime_type: 'text/plain',
  original_filename: 'forwarded-notes-test.txt',
  status: 'embedding',
  meta: { source: 'teaching-test-orphan' },
}).select().single();
const oEmb = await embed(orphanText);
await sb.from('document_chunks').insert([{
  document_id: odoc.id, business_id: biz.id, chunk_index: 0,
  content: orphanText, token_count: Math.ceil(orphanText.length / 4), embedding: oEmb,
}]);
await sb.from('documents').update({ status: 'ready' }).eq('id', odoc.id);
console.log('  ✓ Saved & embedded');

// ── TEST 3: Retrieval ──
console.log('\n[3/3] Testing retrieval — does Alfred find what we taught?');
async function retrieve(query) {
  const qEmb = await embed(query);
  const { data, error } = await sb.rpc('match_document_chunks', {
    query_embedding: qEmb,
    match_threshold: 0.2,
    match_count: 5,
    p_business_id: biz.id,
  });
  if (error) { console.log('  RPC error (will list all instead):', error.message); return null; }
  return data;
}
for (const q of [
  'how much for a logo?',
  'do you work with NGOs?',
  'is Sara a happy client?',
  'what is your turnaround?',
]) {
  console.log(`\n  Q: "${q}"`);
  const hits = await retrieve(q);
  if (!hits) {
    const { data: chunks } = await sb.from('document_chunks').select('content').eq('business_id', biz.id).limit(2);
    console.log(`  (RPC missing — KB has ${chunks?.length || 0} chunks; first chunk preview: ${(chunks?.[0]?.content || '').slice(0, 120)}...)`);
    break;
  }
  for (const h of hits.slice(0, 2)) {
    console.log(`  → [${h.similarity?.toFixed(2)}] ${(h.content || '').slice(0, 140).replace(/\n/g, ' ')}...`);
  }
}

// ── Summary counts ──
const { count: docCount } = await sb.from('documents').select('id', { count: 'exact', head: true }).eq('business_id', biz.id);
const { count: chunkCount } = await sb.from('document_chunks').select('id', { count: 'exact', head: true }).eq('business_id', biz.id);
console.log(`\n✓ Done. Business now has ${docCount} documents, ${chunkCount} chunks.`);
