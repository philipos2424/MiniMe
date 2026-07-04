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

const EVENT_TYPES = new Set(['view_market', 'view_product', 'click_chat']);
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
      ? { q: String(body.meta.q || '').slice(0, 100) || undefined, category: String(body.meta.category || '').slice(0, 60) || undefined }
      : null,
  };

  supabase().from('market_events').insert(row).then(() => {}, e => console.warn('[market] event insert failed:', e.message));
  return NextResponse.json({ ok: true });
}
