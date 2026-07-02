/**
 * GET /api/cron/agent-task-nudges — re-ping owners who never approved a drafted task.
 *
 * /api/cron/agent-tasks drafts owner_action tasks and DMs an Approve / Cancel
 * preview, flipping status to 'awaiting_approval'. If the owner never taps a
 * button, the task just sits there — this cron re-sends the same preview
 * (with a "still waiting" framing) a bounded number of times, then gives up.
 *
 * Registered in vercel.json once daily.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { tg } from '../../../../lib/server/telegramApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const NUDGE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_NUDGES = 3;

function resolveToken(b) {
  if (b?.telegram_bot_token_enc) {
    try { return decrypt(b.telegram_bot_token_enc); } catch {}
  }
  return AGENT_TOKEN || null;
}

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const cutoff = new Date(Date.now() - NUDGE_INTERVAL_MS).toISOString();

  const { data: stuck, error } = await sb.from('agent_tasks')
    .select('id, business_id, payload, nudge_count, last_nudged_at, fired_at')
    .eq('type', 'owner_action')
    .eq('status', 'awaiting_approval')
    .lt('nudge_count', MAX_NUDGES)
    .or(`last_nudged_at.is.null,last_nudged_at.lt.${cutoff}`)
    .lt('fired_at', cutoff)
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!stuck?.length) return NextResponse.json({ ok: true, nudged: 0 });

  const bizIds = [...new Set(stuck.map(t => t.business_id))];
  const { data: businesses } = await sb.from('businesses')
    .select('id, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, panic_mode')
    .in('id', bizIds);
  const bizById = new Map((businesses || []).map(b => [b.id, b]));

  let nudged = 0;
  for (const task of stuck) {
    const business = bizById.get(task.business_id);
    if (!business || business.panic_mode) continue;
    const chatId = business.owner_private_chat_id || business.owner_telegram_id;
    if (!chatId) continue;
    const token = resolveToken(business);
    if (!token) continue;

    const draft = task.payload?.message_draft;
    if (!draft) continue;

    const res = await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: `⏳ *Still waiting on your OK*\n\n${draft}\n\n_Send it now, in your name?_`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Send', callback_data: `task_send_${task.id}` },
          { text: '❌ Cancel', callback_data: `task_cancel_${task.id}` },
        ]],
      },
    }).catch(() => null);

    if (res?.ok) {
      await sb.from('agent_tasks').update({
        nudge_count: (task.nudge_count || 0) + 1,
        last_nudged_at: new Date().toISOString(),
        notification_message_id: res.result?.message_id,
      }).eq('id', task.id);
      nudged++;
    }
  }

  return NextResponse.json({ ok: true, nudged, total: stuck.length });
}
