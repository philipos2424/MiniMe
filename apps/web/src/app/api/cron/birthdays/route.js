/**
 * GET /api/cron/birthdays
 * Runs daily at 7am EAT (4am UTC) — vercel.json schedule: "0 4 * * *"
 *
 * For each business with customers who have a birthday today:
 *   1. Sends the customer a birthday wish via Telegram
 *   2. Sends the owner a heads-up (day before) with an optional discount suggestion
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function sendTelegram(token, chatId, text, extra = {}) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
}

function resolveToken(business) {
  if (business.telegram_bot_token_enc) {
    try { return decrypt(business.telegram_bot_token_enc); } catch {}
  }
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export async function GET(request) {
  // Cron auth
  const authHeader = request.headers.get('authorization');
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const now = new Date();

  // Today's date in EAT (UTC+3): MM-DD format for birthday matching
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const todayMMDD = `${String(eat.getUTCMonth() + 1).padStart(2, '0')}-${String(eat.getUTCDate()).padStart(2, '0')}`;
  const tomorrowEat = new Date(eat.getTime() + 86400000);
  const tomorrowMMDD = `${String(tomorrowEat.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrowEat.getUTCDate()).padStart(2, '0')}`;

  let wishesSent = 0;
  let headsUpSent = 0;

  // Find customers with birthday today or tomorrow
  // birthday column stores YYYY-MM-DD — we match on the MM-DD portion
  const { data: customers } = await sb.from('customers')
    .select('id, name, telegram_id, birthday, business_id, loyalty_points')
    .not('birthday', 'is', null)
    .not('telegram_id', 'is', null);

  if (!customers?.length) {
    return NextResponse.json({ ok: true, wishes: 0, headsUp: 0 });
  }

  // Group by business
  const byBusiness = {};
  for (const c of customers) {
    if (!c.birthday) continue;
    const bday = c.birthday.slice(5); // MM-DD
    if (bday !== todayMMDD && bday !== tomorrowMMDD) continue;
    if (!byBusiness[c.business_id]) byBusiness[c.business_id] = { today: [], tomorrow: [] };
    if (bday === todayMMDD) byBusiness[c.business_id].today.push(c);
    else byBusiness[c.business_id].tomorrow.push(c);
  }

  const businessIds = Object.keys(byBusiness);
  if (!businessIds.length) return NextResponse.json({ ok: true, wishes: 0, headsUp: 0 });

  const { data: businesses } = await sb.from('businesses')
    .select('id, name, telegram_bot_token_enc, owner_private_chat_id, owner_telegram_id')
    .in('id', businessIds);

  const bizMap = Object.fromEntries((businesses || []).map(b => [b.id, b]));

  for (const [bizId, { today, tomorrow }] of Object.entries(byBusiness)) {
    const biz = bizMap[bizId];
    if (!biz) continue;
    const token = resolveToken(biz);
    if (!token) continue;
    const ownerChat = biz.owner_private_chat_id || biz.owner_telegram_id;

    // Send birthday wishes to customers with birthday today
    for (const c of today) {
      const firstName = (c.name || '').split(/\s+/)[0] || 'there';
      const isLoyal = (c.loyalty_points || 0) >= 100;
      const text = isLoyal
        ? `🎂 *Happy Birthday, ${firstName}!*\n\nWishing you a wonderful day from all of us at *${biz.name}*. As one of our valued customers, you make our work meaningful. 🎉\n\nHope you have an amazing celebration! 🥳`
        : `🎂 *Happy Birthday, ${firstName}!*\n\nWishing you a wonderful day from all of us at *${biz.name}*. 🎉\n\nThank you for shopping with us! 🥳`;
      await sendTelegram(token, c.telegram_id, text);
      wishesSent++;
    }

    // Send heads-up to owner for tomorrow's birthdays
    if (tomorrow.length > 0 && ownerChat) {
      const names = tomorrow.map(c => c.name || 'A customer').join(', ');
      const plural = tomorrow.length > 1;
      await sendTelegram(token, ownerChat,
        `🎂 *Birthday tomorrow!*\n\n${names} ${plural ? 'have' : 'has'} a birthday tomorrow.\n\nConsider sending a personal message or a special discount code to make ${plural ? 'their' : 'their'} day. Go to *Customers* in MiniMe to view ${plural ? 'their' : 'their'} profiles.`,
        { parse_mode: 'Markdown' }
      );
      headsUpSent += tomorrow.length;
    }
  }

  return NextResponse.json({ ok: true, wishes: wishesSent, headsUp: headsUpSent });
}
