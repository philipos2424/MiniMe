/**
 * POST /api/market/notify — "we don't have it yet — tell me when it's available".
 *
 * Adds the shopper's query to search_waitlist; the daily notify-waitlist cron
 * messages them via @MiniMeSearchBot when a matching shop joins. Needs a
 * Telegram user id (that's the only way to message them back) — outside
 * Telegram the UI points the user to @MiniMeSearchBot instead.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { rateLimit } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(ip, 'market-notify', 20, 60).ok) return NextResponse.json({ ok: true });

  let body = {};
  try { body = await request.json(); } catch {}

  const tgUserId = String(body.tg_user_id || '');
  const q = String(body.q || '').trim().slice(0, 100);
  const category = String(body.category || '').trim().slice(0, 60) || null;

  // No Telegram id → can't message them back. Tell the UI to hand off to the bot.
  if (!/^\d{1,32}$/.test(tgUserId)) {
    return NextResponse.json({ ok: false, needs_telegram: true });
  }
  if (!q && !category) return NextResponse.json({ error: 'q or category required' }, { status: 400 });

  const keywords = q.toLowerCase().split(/\s+/).filter(w => w.length >= 3).slice(0, 6);

  // Don't stack duplicates: skip if this user already has a pending entry for
  // the same query.
  const { data: existing } = await supabase().from('search_waitlist')
    .select('id')
    .eq('searcher_telegram_id', tgUserId)
    .eq('raw_query', q || category)
    .is('notified_at', null)
    .maybeSingle();

  if (!existing) {
    await supabase().from('search_waitlist').insert({
      searcher_telegram_id: tgUserId,
      raw_query: q || category,
      parsed_category: category,
      keywords,
    });
  }

  return NextResponse.json({ ok: true });
}
