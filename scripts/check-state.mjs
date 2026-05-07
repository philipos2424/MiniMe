import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.test', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\n$/, '')]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('URL:', env.NEXT_PUBLIC_SUPABASE_URL);
console.log('Key prefix:', (env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 12) + '...');
for (const t of ['businesses', 'customers', 'documents']) {
  const r = await sb.from(t).select('id', { count: 'exact', head: true });
  console.log(`${t}:`, JSON.stringify({ count: r.count, status: r.status, error: r.error }));
}
const r2 = await sb.from('businesses').select('*').limit(3);
console.log('Businesses query:', JSON.stringify({ status: r2.status, error: r2.error, len: r2.data?.length }));
if (r2.data?.length) console.log('First business sample:', { id: r2.data[0].id, name: r2.data[0].name, owner: r2.data[0].owner_telegram_id });
