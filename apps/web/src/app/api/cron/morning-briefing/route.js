/**
 * GET /api/cron/morning-briefing
 * The owner's daily brief at 8am EAT (5am UTC): yesterday's sales and costs,
 * who's waiting, who owes money, what's low, and old work to tidy, each with
 * a button. Owners who turned it on always get it; owners who haven't turned
 * it off get it on days there is something to act on, while the shop is in
 * use. Before, only owners who found the setting (10 of 688) got anything,
 * and it had no buttons. Also expires unpaid orders that are a month old.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { sendMorningBrief, expireOldOrders } from '../../../../lib/server/ownerOps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ACTIVE_DAYS = 14;

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  const sb = supabase();
  let expired = 0;
  try { expired = await expireOldOrders(); } catch (e) { console.warn('[morning-briefing] expire', e.message); }

  const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const activeSince = new Date(Date.now() - ACTIVE_DAYS * 86400000).toISOString().slice(0, 10);
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, telegram_biz_conn_id, shop_code, onboarding_completed, notification_prefs, currency, last_shop_activity_date')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)')
    .not('owner_telegram_id', 'is', null);

  const results = [];
  for (const b of businesses || []) {
    if (Date.now() - started > 270000) { results.push({ business: b.name, skipped: 'time' }); break; }
    const cfg = b.notification_prefs?.morning_summary;
    const activeRecently = !!b.last_shop_activity_date && b.last_shop_activity_date >= activeSince;
    if (cfg?.enabled === false || (cfg?.enabled !== true && !activeRecently)) continue;

    let token;
    if (b.telegram_bot_token_enc) {
      try { token = decrypt(b.telegram_bot_token_enc); } catch { continue; }
    } else token = AGENT_TOKEN;
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    if (!chatId || !token) continue;

    try {
      const r = await sendMorningBrief({ token, business: b, chatId, activeRecently });
      if (r.sent || r.reason !== 'nothing_to_act_on') results.push({ business: b.name, sent: r.sent, reason: r.reason });
    } catch (e) {
      console.warn('[morning-briefing] failed for', b.name, e.message);
      results.push({ business: b.name, sent: false, reason: e.message });
    }
  }
  return NextResponse.json({ ok: true, expired_orders: expired, sent_count: results.filter(r => r.sent).length, results });
}
