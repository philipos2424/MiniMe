/**
 * Owner-task executor — the "draft" half of owner-assigned scheduled tasks.
 *
 * Lifecycle (see migration 023_owner_tasks.sql):
 *   handleOwnerPrompt → agent_tasks row (type 'owner_action', status 'pending', scheduled_at)
 *   /api/cron/agent-tasks → draftDueOwnerTask()  [THIS FILE]
 *       → drafts the message in the owner's voice
 *       → status 'awaiting_approval', stores payload.message_draft
 *       → DMs the owner an Approve / Cancel preview (stores notification_message_id)
 *   owner taps ✅ Send → replyEngine callback `task_send_<id>` performs the real
 *       send (ownerDmClient / ownerDmTeam / broadcastToClients) and either marks
 *       'completed' or re-arms the next occurrence for recurring tasks.
 *
 * Approval-first by design: the agent never sends in the owner's name unprompted.
 */
import OpenAI from 'openai';
import { MODEL_MINI } from './constants';
import { tg } from './telegramApi';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

function actionLabel(action, target) {
  if (action === 'broadcast') return `broadcast to ${target}`;
  if (action === 'dm_team') return `team message to ${target}`;
  return `message to ${target}`;
}

function recurrenceLabel(rec) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (rec?.kind === 'weekly') return `every ${days[rec.day_of_week] ?? 'week'} at ${rec.time_eat}`;
  if (rec?.kind === 'daily') return `every day at ${rec.time_eat}`;
  return null;
}

/** Polish the owner's note into a warm, natural message in their voice. */
async function draftMessage({ business, action, target, message }) {
  const owner = business.owner_name || 'the owner';
  const recipient = action === 'broadcast'
    ? `several customers (${target})`
    : action === 'dm_team'
      ? `a team member / supplier (${target})`
      : `a customer (${target})`;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_MINI,
      temperature: 0.5,
      max_tokens: 220,
      messages: [{
        role: 'user',
        content:
          `You are writing a Telegram message AS ${owner}, owner of ${business.name}.\n` +
          `Rewrite the owner's note into a warm, natural, brief message in their voice.\n` +
          `Rules: keep it short and human; use contractions; no quotation marks; no "[from owner]"; no signature; ` +
          `match the language of the note (English or Amharic).\n\n` +
          `Recipient: ${recipient}\n` +
          `Owner's note: """${message || ''}"""\n\n` +
          `Return ONLY the message text.`,
      }],
    });
    const txt = (completion.choices?.[0]?.message?.content || '').trim();
    return txt || (message || '').trim();
  } catch (e) {
    console.warn('[taskRunner] draft failed, using raw note:', e.message);
    return (message || '').trim();
  }
}

/**
 * Draft one due owner_action task and send the owner an approve/cancel preview.
 * Mutates the row: status → 'awaiting_approval', payload.message_draft, notification_message_id.
 * Returns { ok, error?, skipped? }.
 */
export async function draftDueOwnerTask({ sb, token, business, task }) {
  const chatId = business.owner_private_chat_id || business.owner_telegram_id;
  if (!chatId) return { ok: false, error: 'no_owner_chat' };

  const p = task.payload || {};
  const { action, target, message } = p;
  if (!action || !target) {
    await sb.from('agent_tasks').update({ status: 'failed' }).eq('id', task.id);
    return { ok: false, error: 'bad_payload' };
  }

  const draft = await draftMessage({ business, action, target, message });
  if (!draft) {
    await sb.from('agent_tasks').update({ status: 'failed' }).eq('id', task.id);
    return { ok: false, error: 'empty_draft' };
  }

  // Flip to awaiting_approval BEFORE notifying so a retry can't double-send the preview.
  await sb.from('agent_tasks').update({
    status: 'awaiting_approval',
    payload: { ...p, message_draft: draft },
    fired_at: new Date().toISOString(),
  }).eq('id', task.id);

  const rec = p.recurrence;
  const repeatLine = recurrenceLabel(rec) ? `🔁 _${recurrenceLabel(rec)}_\n` : '';
  const text =
    `🗓 *Scheduled task ready*\n${repeatLine}\n` +
    `*${actionLabel(action, target)}*\n\n` +
    `${draft}\n\n` +
    `_Send it now, in your name?_`;

  const res = await tg(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Send', callback_data: `task_send_${task.id}` },
        { text: '❌ Cancel', callback_data: `task_cancel_${task.id}` },
      ]],
    },
  });

  if (res?.ok && res.result?.message_id) {
    await sb.from('agent_tasks').update({ notification_message_id: res.result.message_id }).eq('id', task.id);
  }
  return { ok: true };
}
