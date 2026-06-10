/**
 * GET /api/cron/morning-briefing
 * Sends a personalised morning briefing to each owner at 8am EAT (5am UTC).
 * Only sends if morning_summary.enabled = true in notification_prefs.
 * Runs daily — scheduled in vercel.json.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  const authed =
    isCronAuthorized(request);
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const since7d  = new Date(Date.now() - 7 * 86400000).toISOString();
  const since24h = new Date(Date.now() - 24 * 3600000).toISOString();
  const EAT = 3 * 60 * 60 * 1000;
  const nowEAT = new Date(Date.now() + EAT);
  const startOfDayEAT = new Date(nowEAT); startOfDayEAT.setUTCHours(0, 0, 0, 0);
  const startOfDayUTC = new Date(startOfDayEAT.getTime() - EAT);

  const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, shop_code, onboarding_completed, notification_prefs, trust_level')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)')
    .not('owner_telegram_id', 'is', null);

  const sent = [];

  for (const b of businesses || []) {
    // Check opt-in
    const cfg = b.notification_prefs?.morning_summary;
    if (!cfg?.enabled) continue;

    let token;
    if (b.telegram_bot_token_enc) {
      try { token = decrypt(b.telegram_bot_token_enc); } catch { continue; }
    } else {
      if (!AGENT_TOKEN) continue;
      token = AGENT_TOKEN;
    }
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    if (!chatId || !token) continue;

    try {
      // Gather today's key stats
      const [
        { count: msgToday },
        { count: draftsWaiting },
        { data: todayOrders },
        { count: newCustomers },
        { count: learnedYday },
      ] = await Promise.all([
        sb.from('messages').select('id', { count: 'exact', head: true })
          .eq('business_id', b.id).eq('direction', 'inbound')
          .gte('created_at', startOfDayUTC.toISOString()),
        sb.from('conversations').select('id', { count: 'exact', head: true })
          .eq('business_id', b.id).eq('requires_owner', true).eq('status', 'active'),
        sb.from('orders').select('total, currency, status')
          .eq('business_id', b.id).gte('paid_at', since24h)
          .in('status', ['paid', 'fulfilled']),
        sb.from('customers').select('id', { count: 'exact', head: true })
          .eq('business_id', b.id).gte('created_at', since24h),
        // Things MiniMe taught itself in the last 24h (owner corrections + daily mining)
        sb.from('documents').select('id', { count: 'exact', head: true })
          .eq('business_id', b.id).eq('tag', 'auto-learned')
          .gte('created_at', since24h),
      ]);

      const revenue = (todayOrders || []).reduce((s, o) => s + Number(o.total || 0), 0);
      const currency = todayOrders?.[0]?.currency || 'ETB';
      const ownerFirst = (b.owner_name || '').split(' ')[0] || '';

      const h = nowEAT.getUTCHours();
      const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

      const lines = [
        `${greet}${ownerFirst ? `, ${ownerFirst}` : ''}! ☀️`,
        ``,
        `Here's your *${b.name}* briefing:`,
        ``,
      ];

      if (draftsWaiting > 0) lines.push(`📩 *${draftsWaiting} draft${draftsWaiting > 1 ? 's' : ''}* waiting for your approval`);
      if (msgToday > 0) lines.push(`💬 *${msgToday} message${msgToday > 1 ? 's' : ''}* received since midnight`);
      if (revenue > 0) lines.push(`💰 *${revenue.toLocaleString()} ${currency}* revenue in last 24h`);
      if (newCustomers > 0) lines.push(`👤 *${newCustomers} new customer${newCustomers > 1 ? 's' : ''}* today`);
      if (learnedYday > 0) lines.push(`🧠 *${learnedYday} thing${learnedYday > 1 ? 's' : ''}* learned from your chats`);

      if (lines.length <= 4) {
        lines.push(`✅ All quiet — MiniMe is on duty and handling your customers.`);
      }

      lines.push(``, `_Open MiniMe to review and manage your business_ 👇`);

      const MINIAPP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines.join('\n'),
          parse_mode: 'Markdown',
          reply_markup: MINIAPP_URL ? {
            inline_keyboard: [[
              { text: '📱 Open MiniMe', web_app: { url: MINIAPP_URL } },
            ]],
          } : undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });

      sent.push({ business: b.name, drafts: draftsWaiting, revenue });
    } catch (e) {
      console.warn('[morning-briefing] failed for', b.name, e.message);
    }
  }

  return NextResponse.json({ ok: true, sent_count: sent.length, sent });
}
