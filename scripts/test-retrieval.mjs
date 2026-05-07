// Just retest retrieval with the correct RPC name. No re-teaching.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.test', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\n$/, '')]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const { data: bs } = await sb.from('businesses').select('id, name').limit(1);
const biz = bs[0];
console.log('Business:', biz.name);

async function ask(q) {
  const e = (await openai.embeddings.create({ model: 'text-embedding-3-small', input: [q] })).data[0].embedding;
  const { data, error } = await sb.rpc('match_document_chunks', {
    query_embedding: e, match_threshold: 0.2, match_count: 3, p_business_id: biz.id,
  });
  if (error) { console.log('ERR', error.message); return; }
  console.log(`\nQ: ${q}`);
  for (const h of data || []) {
    console.log(`  [sim ${h.similarity?.toFixed(2)}] ${(h.content || '').slice(0, 160).replace(/\s+/g, ' ')}`);
  }
}

for (const q of [
  'how much for a logo?',
  'do you work with NGOs?',
  'is Sara a happy client?',
  'what is your turnaround?',
  'wedding invitations',
  'price for branding',
]) await ask(q);
