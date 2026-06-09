/**
 * GET /api/cron/b2b-follow-up — daily sweep that nudges non-responders.
 *
 * Finds B2B messages that have been sitting at status='delivered' for >24h
 * without a reply, and sends a polite follow-up via the recipient's bot to
 * their owner. Up to 2 follow-ups per message before giving up (the
 * b2b-expire cron / research-timeout will then close them out).
 *
 * On Vercel Hobby (daily crons only), the cadence is effectively every 24h
 * — so "6h/18h follow-up windows" become a single daily nudge. Upgrade to
 * Pro to run this every 6h for the original cadence.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { tg } from '../../../../lib/server/telegramApi';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FOLLOW_UP_AFTER_HOURS = 24;     // first nudge: 24h after delivery (Hobby tier)
const SECOND_NUDGE_AFTER_HOURS = 48;  // second nudge: 48h after delivery
const MAX_FOLLOW_UPS = 2;

export async function GET(request) {
  const authed = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const firstCutoff = new Date(Date.now() - FOLLOW_UP_AFTER_HOURS * 3600000).toISOString();

  // All delivered messages with no reply yet, eligible for a nudge
  const { data: stale, error } = await sb
    .from('business_messages')
    .select('id, thread_id, sender_id, recipient_id, content, intent, follow_up_count, delivered_at, last_follow_up_at, parent_id, structured')
    .eq('status', 'delivered')
    .lt('delivered_at', firstCutoff)
    .lt('follow_up_count', MAX_FOLLOW_UPS)
    .limit(100);

  if (error) {
    console.error('[b2b-follow-up] query', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results = [];
  for (const m of stale || []) {
    // Skip if it's a reply itself (avoid follow-ups on follow-ups)
    if (m.intent === 'reply') continue;
    // Skip if last follow-up was recent
    if (m.last_follow_up_at) {
      const sinceLast = Date.now() - new Date(m.last_follow_up_at).getTime();
      const minGap = (m.follow_up_count >= 1 ? SECOND_NUDGE_AFTER_HOURS - FOLLOW_UP_AFTER_HOURS : 0) * 3600000;
      if (sinceLast < minGap) continue;
    }
    try {
      const r = await sendFollowUp(m);
      results.push({ id: m.id, ...r });
    } catch (e) {
      console.error('[b2b-follow-up]', m.id, e.message);
      results.push({ id: m.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, examined: (stale || []).length, nudged: results.filter(r => r.ok).length, results });
}

async function sendFollowUp(msg) {
  const sb = supabase();

  // Load the recipient business (we need their bot token to nudge their owner)
  const { data: recipientBiz } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_token_enc, owner_telegram_id, owner_private_chat_id')
    .eq('id', msg.recipient_id)
    .maybeSingle();
  const { data: senderBiz } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_username')
    .eq('id', msg.sender_id)
    .maybeSingle();
  if (!recipientBiz || !senderBiz) return { ok: false, error: 'business_missing' };
  if (!recipientBiz.telegram_bot_token_enc) return { ok: false, error: 'no_token' };

  let token;
  try { token = decrypt(recipientBiz.telegram_bot_token_enc); } catch { return { ok: false, error: 'decrypt_fail' }; }
  const chat = recipientBiz.owner_private_chat_id || recipientBiz.owner_telegram_id;
  if (!token || !chat) return { ok: false, error: 'no_chat' };

  const nudgeNum = (msg.follow_up_count || 0) + 1;
  const original = (msg.content || '').slice(0, 200);
  const senderLabel = senderBiz.name + (senderBiz.telegram_bot_username ? ` (@${senderBiz.telegram_bot_username})` : '');

  const text = nudgeNum === 1
    ? `🔔 *Quick follow-up*\n\n${escapeMd(senderLabel)} reached out about:\n_"${escapeMd(original)}"_\n\nHave you had a chance to respond?`
    : `🔔 *Last check-in*\n\n${escapeMd(senderLabel)} is still waiting on:\n_"${escapeMd(original)}"_\n\nLet them know if this isn't a fit — they'll move on either way.`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✍️ Reply now',  callback_data: `b2b:reply:${msg.id}` },
        { text: '🤖 Let MiniMe answer', callback_data: `b2b:ai:${msg.id}` },
      ],
      [
        { text: '✕ Decline', callback_data: `b2b:decline:${msg.id}` },
      ],
    ],
  };

  await tg(token, 'sendMessage', {
    chat_id: chat, text, parse_mode: 'Markdown', reply_markup: replyMarkup,
  });

  await sb.from('business_messages')
    .update({
      follow_up_count: nudgeNum,
      last_follow_up_at: new Date().toISOString(),
    })
    .eq('id', msg.id);

  return { ok: true, nudge_num: nudgeNum };
}

function escapeMd(s) {
  return String(s || '').replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}
