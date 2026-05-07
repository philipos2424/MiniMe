// One-shot: wipe agent_thoughts, orders, jobs for ALL businesses.
// Conversations are preserved.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('missing supabase creds'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });

const TABLES = ['agent_thoughts', 'orders', 'jobs'];
const before = {}, after = {};

for (const t of TABLES) {
  const { count } = await sb.from(t).select('id', { count: 'exact', head: true });
  before[t] = count ?? 0;
}
console.log('BEFORE:', before);

for (const t of TABLES) {
  const { error } = await sb.from(t).delete().not('id', 'is', null);
  if (error) console.error(`delete ${t}:`, error.message);
  else console.log(`wiped ${t}`);
}

for (const t of TABLES) {
  const { count } = await sb.from(t).select('id', { count: 'exact', head: true });
  after[t] = count ?? 0;
}
console.log('AFTER:', after);
