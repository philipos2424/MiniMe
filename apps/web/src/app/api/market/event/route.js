/**
 * POST /api/market/event — marketplace usage logging (public, fire-and-forget).
 * Body: { event_type, business_id?, product_id?, tg_user_id?, meta? }.
 * Feeds the Pulse dashboard's market metrics and per-user recommendations.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { rateLimit } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVENT_TYPES = new Set([
  'view_market', 'view_product', 'click_chat',
  'favorite', 'unfavorite', 'share', 'follow', 'unfollow', 'view_shop', 'write_review',
]);
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'market-event', 60, 60);
  if (!rl.ok) return NextResponse.json({ ok: true }); // silently drop floods

  let body = {};
  try { body = await request.json(); } catch {}

  if (!EVENT_TYPES.has(body.event_type)) {
    return NextResponse.json({ error: 'invalid event_type' }, { status: 400 });
  }

  const row = {
    event_type: body.event_type,
    business_id: UUID_RE.test(body.business_id || '') ? body.business_id : null,
    product_id: UUID_RE.test(body.product_id || '') ? body.product_id : null,
    tg_user_id: /^\d{1,32}$/.test(String(body.tg_user_id || '')) ? String(body.tg_user_id) : null,
    meta: body.meta && typeof body.meta === 'object'
      ? {
          q: String(body.meta.q || '').slice(0, 100) || undefined,
          category: String(body.meta.category || '').slice(0, 60) || undefined,
          // 'via' marks how the event originated ('voice' search, or the public
          // web 'directory' vs the Market Mini App) — surfaces adoption per
          // surface in the data without a schema change.
          via: ['voice', 'directory'].includes(body.meta.via) ? body.meta.via : undefined,
          // How many results the query actually produced. The client now sends
          // this once its catalog fetch resolves (see market/page.js
          // flushSearchLog), so Market searches can be bucketed the same way
          // bot searches are.
          results_count: Number.isInteger(body.meta.results_count) && body.meta.results_count >= 0
            ? body.meta.results_count
            : undefined,
        }
      : null,
  };

  supabase().from('market_events').insert(row).then(() => {}, e => console.warn('[market] event insert failed:', e.message));

  // Market searches (typed or voice) also count as MiniMe searches — without
  // this, the admin search-analytics headline totals only ever saw bot
  // searches, silently undercounting the Market Mini App's search volume.
  // Bare app-opens (no q) are NOT logged here — they aren't searches.
  if (body.event_type === 'view_market' && row.meta?.q) {
    const q = row.meta.q;
    supabase().from('search_logs').insert({
      searcher_telegram_id: row.tg_user_id,
      raw_query: q,
      parsed_intent: { source: 'market', ...(row.meta.category ? { category: row.meta.category } : {}) },
      // The client sends the real count now that it logs after its catalog
      // fetch resolves. Still null when absent (an older client, or a caller
      // that genuinely can't know) — null keeps a row out of BOTH the
      // zero-result and found buckets rather than misreporting it as either.
      // This matters: demand.js selects on `results_count = 0`, so every
      // Market zero-result used to be invisible to seller recruitment.
      results_count: row.meta.results_count ?? null,
      language: /[ሀ-፿]/.test(q) ? 'am' : 'en',
      via: row.meta.via === 'voice' ? 'voice' : 'text',
    }).then(({ error }) => { if (error) console.warn('[market] search_logs insert failed:', error.message); })
      .catch(e => console.warn('[market] search_logs insert threw:', e?.message));
  }

  return NextResponse.json({ ok: true });
}
