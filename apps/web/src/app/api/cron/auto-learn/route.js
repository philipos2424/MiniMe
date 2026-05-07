/**
 * GET /api/cron/auto-learn — daily auto-learning across all businesses.
 * Runs at 03:00 UTC (06:00 Addis) before the 09:00 Addis follow-ups cron.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { mineConversationsForBusiness } from '../../../../lib/server/autoLearn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const authed =
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}` ||
    new URL(request.url).searchParams.get('secret') === process.env.CRON_SECRET;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const { data: businesses } = await sb.from('businesses')
    .select('id, name')
    .not('telegram_bot_token_enc', 'is', null);

  const summary = [];
  for (const b of businesses || []) {
    try {
      const r = await mineConversationsForBusiness(b);
      summary.push({ business: b.name, ...r });
    } catch (e) {
      summary.push({ business: b.name, error: e.message });
    }
  }
  return NextResponse.json({ ok: true, summary });
}
