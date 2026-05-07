import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.test', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\n$/, '')]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: docs } = await sb.from('documents').select('id, title, meta').or('meta->>source.eq.teaching-test,meta->>source.eq.teaching-test-orphan');
console.log('Test docs to remove:', docs?.map(d => ({ id: d.id, title: d.title, source: d.meta?.source })));
for (const d of docs || []) {
  await sb.from('document_chunks').delete().eq('document_id', d.id);
  await sb.from('documents').delete().eq('id', d.id);
  console.log('  removed', d.id);
}
await sb.from('customer_memory').delete().eq('source', 'forwarded-test');
console.log('Test customer_memory cleared.');
