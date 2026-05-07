/**
 * GET /api/cron/reminders — fire any owner reminders whose due_at has passed.
 * Scheduled hourly via vercel.json. Reminder accuracy is ±1 hour.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { fireDueReminders } from '../../../../lib/server/ownerCommands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  const authed =
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}` ||
    new URL(request.url).searchParams.get('secret') === process.env.CRON_SECRET;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, telegram_bot_token_enc, owner_telegram_id, notification_prefs')
    .not('telegram_bot_token_enc', 'is', null)
    .not('owner_telegram_id', 'is', null);

  const summary = [];
  for (const b of businesses || []) {
    if (!b.notification_prefs?.reminders?.length) continue;
    let token;
    try { token = decrypt(b.telegram_bot_token_enc); } catch { continue; }
    try {
      const r = await fireDueReminders(token, b);
      if (r.fired) summary.push({ business: b.name, fired: r.fired });
    } catch (e) {
      summary.push({ business: b.name, error: e.message });
    }
  }
  return NextResponse.json({ ok: true, summary });
}
