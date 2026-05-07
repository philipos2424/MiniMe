/**
 * POST /api/agent/jobs/reset — wipe jobs/orders/thoughts for the signed-in owner.
 *
 * Robust to the duplicate-business case: looks up ALL businesses where
 * owner_telegram_id == the caller's TG id and wipes each one, so a stale
 * duplicate row in `businesses` can't silently shield orders/jobs from the
 * delete.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLES = ['agent_thoughts', 'orders', 'jobs'];

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();

  // ALL businesses owned by this telegram id (not .single() — duplicates shouldn't break us)
  const { data: businesses, error: bErr } = await sb
    .from('businesses')
    .select('id, name')
    .eq('owner_telegram_id', tg.id);

  if (bErr) return NextResponse.json({ error: `business lookup: ${bErr.message}` }, { status: 500 });
  if (!businesses?.length) return NextResponse.json({ error: 'no business for this owner' }, { status: 404 });

  const perBusiness = [];
  const errors = [];

  for (const b of businesses) {
    const before = {};
    const after = {};

    for (const t of TABLES) {
      const { count, error } = await sb.from(t).select('id', { count: 'exact', head: true }).eq('business_id', b.id);
      if (error) errors.push(`count ${t} for ${b.id}: ${error.message}`);
      before[t] = count ?? 0;
    }

    for (const t of TABLES) {
      const { error } = await sb.from(t).delete().eq('business_id', b.id);
      if (error) errors.push(`delete ${t} for ${b.id}: ${error.message}`);
    }

    for (const t of TABLES) {
      const { count, error } = await sb.from(t).select('id', { count: 'exact', head: true }).eq('business_id', b.id);
      if (error) errors.push(`recount ${t} for ${b.id}: ${error.message}`);
      after[t] = count ?? 0;
    }

    const deleted = {};
    for (const t of TABLES) deleted[t] = before[t] - after[t];

    perBusiness.push({ business_id: b.id, name: b.name, before, after, deleted });
  }

  // Aggregate for the UI
  const agg = { before: {}, after: {}, deleted: {} };
  for (const t of TABLES) {
    agg.before[t] = perBusiness.reduce((s, p) => s + p.before[t], 0);
    agg.after[t] = perBusiness.reduce((s, p) => s + p.after[t], 0);
    agg.deleted[t] = perBusiness.reduce((s, p) => s + p.deleted[t], 0);
  }

  return NextResponse.json({
    ok: errors.length === 0 && Object.values(agg.after).every(n => n === 0),
    owner_telegram_id: tg.id,
    businesses_scanned: businesses.length,
    businesses: perBusiness,
    ...agg,
    errors,
  });
}
