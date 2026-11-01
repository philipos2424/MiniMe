/**
 * GET /api/cron/secretary-recap — 7:30pm EAT (16:30 UTC).
 *
 * For owners with Secretary connected: "Here's your day on Telegram" — how
 * many people Secretary answered, who is waiting on the owner (things it said
 * it would check), with an "✍️ Answer" button each (sent as the owner), and
 * how many people it couldn't place. Quiet days send nothing. Owners can turn
 * it off from the message (secretary_recap.enabled = false).
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { recapWanted } from '../../../../lib/secretaryPeople.mjs';
import { sendSecretaryRecap } from '../../../../lib/server/secretaryPeopleRun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return NextResponse.json({ error: 'no bot token' }, { status: 500 });
  const { data: businesses } = await supabase().from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_biz_conn_id, notification_prefs')
    .not('telegram_biz_conn_id', 'is', null)
    .not('owner_telegram_id', 'is', null);

  const results = [];
  for (const b of businesses || []) {
    if (Date.now() - started > 270000) { results.push({ business: b.name, skipped: 'time' }); break; }
    if (!recapWanted(b)) continue;
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    try {
      const r = await sendSecretaryRecap({ token, business: b, chatId });
      if (r.sent) results.push({ business: b.name, answered: r.stats.answered, waiting: r.stats.waiting.length });
    } catch (e) {
      console.warn('[secretary-recap]', b.name, e.message);
      results.push({ business: b.name, error: e.message });
    }
  }
  return NextResponse.json({ ok: true, sent: results.filter(r => !r.error && !r.skipped).length, results });
}
