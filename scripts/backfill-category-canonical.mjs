/**
 * Backfill businesses.category_canonical from the freeform `category` /
 * `categories[]` columns, using the SAME normalizer the app writes with
 * (apps/web/src/lib/server/categoryMap.mjs) so SQL and JS can never disagree.
 *
 * Run the migration first:  supabase/migrations/business_category_canonical.sql
 *
 * Usage:
 *   node scripts/backfill-category-canonical.mjs           # dry run (default)
 *   node scripts/backfill-category-canonical.mjs --apply   # write
 *
 * Safe to re-run: it only writes rows whose computed value differs from what
 * is already stored, and it never touches `category` itself.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { canonicalCategoriesOf } from '../apps/web/src/lib/server/categoryMap.mjs';

const APPLY = process.argv.includes('--apply');

// Sibling scripts hardcode apps/web/.env.test, which doesn't exist in this
// checkout. Try the env files that actually do, in order of least surprise.
const ENV_CANDIDATES = ['../apps/web/.env.test', '../apps/web/.env.local', '../.env', '../apps/web/.env.production'];
function loadEnv() {
  for (const rel of ENV_CANDIDATES) {
    let text;
    try { text = readFileSync(new URL(rel, import.meta.url), 'utf8'); } catch { continue; }
    const vars = Object.fromEntries(
      text.replace(/\r\n/g, '\n')
        .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\n$/, '')]; })
    );
    if (vars.NEXT_PUBLIC_SUPABASE_URL && vars.SUPABASE_SERVICE_ROLE_KEY) {
      console.log(`env: ${rel}`);
      return vars;
    }
  }
  console.error(`no env file with SUPABASE credentials found (tried: ${ENV_CANDIDATES.join(', ')})`);
  process.exit(1);
}
const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Page through every business — .select() caps at 1000 rows per request.
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('businesses')
    .select('id, name, category, categories, category_canonical')
    .order('id').range(from, from + 999);
  if (error) { console.error('fetch failed:', error.message); process.exit(1); }
  rows.push(...(data || []));
  if (!data || data.length < 1000) break;
}

// The first canonical claim wins; a shop with none stays NULL (eligible for
// every category rather than forced into a wrong bucket).
const changes = [];
const histogram = {};
for (const b of rows) {
  const next = canonicalCategoriesOf(b)[0] || null;
  histogram[next || '(none)'] = (histogram[next || '(none)'] || 0) + 1;
  if (next !== (b.category_canonical || null)) changes.push({ id: b.id, name: b.name, from: b.category, next });
}

console.log(`scanned ${rows.length} businesses · ${changes.length} need updating\n`);
console.log('resulting distribution:');
for (const [k, v] of Object.entries(histogram).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

// Show what the freeform values collapse into, so the mapping is reviewable
// before it is applied rather than after.
const byTarget = {};
for (const c of changes) (byTarget[c.next || '(none)'] ||= new Set()).add(c.from || '(null)');
console.log('\nfreeform → canonical:');
for (const [target, sources] of Object.entries(byTarget).sort()) {
  console.log(`  ${target}:`);
  for (const s of [...sources].sort()) console.log(`      ${s}`);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
  process.exit(0);
}

let ok = 0, failed = 0;
for (const c of changes) {
  const { error } = await sb.from('businesses').update({ category_canonical: c.next }).eq('id', c.id);
  if (error) { failed++; console.warn(`  ! ${c.name}: ${error.message}`); } else ok++;
}
console.log(`\napplied: ${ok} updated, ${failed} failed`);
