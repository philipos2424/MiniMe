/**
 * POST /api/agent/team/[id]/ping — send a 1-line test DM to this team member.
 * Returns the raw Telegram response so the owner can see the actual error
 * (chat not found, blocked, bad ID, etc.).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../../lib/server/businesses';
import { supabase } from '../../../../../../lib/server/db';
import { decrypt } from '../../../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no business' }, { status: 404 });

  const { data: supplier } = await supabase().from('suppliers').select('*')
    .eq('id', params.id).eq('business_id', business.id).maybeSingle();
  if (!supplier) return NextResponse.json({ error: 'team member not found' }, { status: 404 });

  const diag = {
    name: supplier.name,
    role: supplier.role,
    contact_telegram: supplier.contact_telegram,
    telegram_username: supplier.telegram_username,
    is_active: supplier.is_active,
  };

  if (!supplier.contact_telegram) {
    return NextResponse.json({ ok: false, reason: 'no contact_telegram numeric ID on this member', diag });
  }

  // Resolve bot token — never silently fall back to platform bot.
  let token = null;
  let usingBusinessToken = false;
  if (business.telegram_bot_token_enc) {
    try { token = decrypt(business.telegram_bot_token_enc); usingBusinessToken = true; }
    catch (e) { console.error(`[CRITICAL] decrypt failed for business ${business.id}:`, e.message); }
  } else {
    token = process.env.TELEGRAM_BOT_TOKEN;  // No custom token → legitimate platform bot
  }
  if (!token) return NextResponse.json({ ok: false, reason: 'no bot token configured' });

  // Also fetch which bot this is so the owner knows who the team member should've messaged.
  let botInfo = null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json();
    if (j.ok) botInfo = { username: j.result.username, first_name: j.result.first_name, id: j.result.id };
  } catch {}

  // Attempt the DM.
  let tgResponse = null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: supplier.contact_telegram,
        text: `🔔 Test from ${business.name} — if you see this, MiniMe can reach you. You don't need to reply.`,
      }),
    });
    tgResponse = await r.json();
  } catch (e) {
    return NextResponse.json({ ok: false, reason: `network error: ${e.message}`, diag, botInfo, usingBusinessToken });
  }

  if (tgResponse?.ok) {
    return NextResponse.json({ ok: true, diag, botInfo, usingBusinessToken, telegram: tgResponse });
  }
  // Common failure hints
  const desc = tgResponse?.description || 'unknown';
  let hint = desc;
  if (/chat not found/i.test(desc)) {
    hint = `Telegram says "chat not found". The numeric ID ${supplier.contact_telegram} either doesn't exist, is wrong, or this user has never messaged @${botInfo?.username || 'your bot'}. Ask ${supplier.name} to open @${botInfo?.username || 'your bot'} and tap Start.`;
  } else if (/blocked/i.test(desc)) {
    hint = `${supplier.name} has blocked @${botInfo?.username || 'your bot'}. Ask them to unblock it.`;
  } else if (/deactivated/i.test(desc)) {
    hint = `${supplier.name}'s Telegram account is deactivated.`;
  } else if (/bot can't initiate/i.test(desc) || /can't send messages to bots/i.test(desc)) {
    hint = `Telegram refuses: the user hasn't messaged @${botInfo?.username || 'your bot'} yet. Ask ${supplier.name} to open the bot and tap Start.`;
  }
  return NextResponse.json({
    ok: false,
    reason: hint,
    rawDescription: desc,
    telegram: tgResponse,
    diag, botInfo, usingBusinessToken,
  });
}
