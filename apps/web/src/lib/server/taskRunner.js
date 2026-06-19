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
 * Auto-send / chase-until-reply tasks skip the approval loop: they draft, send,
 * and re-arm automatically. The owner is notified after each send.
 */
import OpenAI from 'openai';
import { MODEL_MINI } from './constants';
import { tg } from './telegramApi';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

const EAT_MS = 3 * 60 * 60 * 1000;

const INTERVAL_MS = {
  every_6h: 6 * 3600000,
  daily:    24 * 3600000,
  every_2d: 48 * 3600000,
  weekly:   7 * 24 * 3600000,
};

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
async function draftMessage({ business, action, target, message, attempt }) {
  const owner = business.owner_name || 'the owner';
  const recipient = action === 'broadcast'
    ? `several customers (${target})`
    : action === 'dm_team'
      ? `a team member / supplier (${target})`
      : `a customer (${target})`;
  const followUpNote = (attempt && attempt > 0)
    ? `\nThis is follow-up #${attempt + 1}. Vary the wording — don't repeat the exact same message. Keep it friendly but make it clear you're checking back.`
    : '';
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_MINI,
      temperature: 0.6,
      max_tokens: 220,
      messages: [{
        role: 'user',
        content:
          `You are writing a Telegram message AS ${owner}, owner of ${business.name}.\n` +
          `Rewrite the owner's note into a warm, natural, brief message in their voice.\n` +
          `Rules: keep it short and human; use contractions; no quotation marks; no "[from owner]"; no signature; ` +
          `match the language of the note (English or Amharic).${followUpNote}\n\n` +
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

  // ── Chase-until-reply: check if target replied since last send ────────────
  if (p.chase_until_reply && p.customer_id && p.last_sent_at) {
    const { data: conv } = await sb.from('conversations')
      .select('id')
      .eq('business_id', task.business_id).eq('customer_id', p.customer_id)
      .order('last_message_at', { ascending: false })
      .limit(1).maybeSingle();
    if (conv) {
      const { data: replies } = await sb.from('messages')
        .select('id').eq('conversation_id', conv.id).eq('direction', 'inbound')
        .gt('created_at', p.last_sent_at).limit(1);
      if (replies?.length) {
        await sb.from('agent_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', task.id);
        await tg(token, 'sendMessage', {
          chat_id: chatId, parse_mode: 'Markdown',
          text: `✅ *${target}* replied! Follow-up complete (after ${p.attempt || 1} message${(p.attempt || 1) > 1 ? 's' : ''}).`,
        });
        return { ok: true, chase_resolved: true };
      }
    }
  }

  // ── Chase exhaustion check ────────────────────────────────────────────────
  if (p.chase_until_reply && (p.attempt || 0) >= (p.max_attempts || 5)) {
    await sb.from('agent_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', task.id);
    await tg(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown',
      text: `⚠️ *${target}* didn't reply after ${p.attempt} follow-ups. I've stopped — want me to try a different approach?`,
    });
    return { ok: true, chase_exhausted: true };
  }

  const draft = await draftMessage({ business, action, target, message, attempt: p.attempt });
  if (!draft) {
    await sb.from('agent_tasks').update({ status: 'failed' }).eq('id', task.id);
    return { ok: false, error: 'empty_draft' };
  }

  // ── Auto-send path (follow_up / chase tasks) ─────────────────────────────
  if (p.auto_send) {
    const recipientId = p.recipient_tg_id;
    if (!recipientId) {
      await sb.from('agent_tasks').update({ status: 'failed' }).eq('id', task.id);
      return { ok: false, error: 'no_recipient' };
    }

    const sendRes = await tg(token, 'sendMessage', {
      chat_id: recipientId, text: draft,
      ...(business.telegram_biz_conn_id && { business_connection_id: business.telegram_biz_conn_id }),
    });

    if (!sendRes?.ok) {
      await tg(token, 'sendMessage', {
        chat_id: chatId, text: `⚠️ Follow-up to *${target}* failed: ${sendRes?.description || 'unknown error'}`,
        parse_mode: 'Markdown',
      });
    } else {
      // Record outbound in conversation
      if (p.customer_id) {
        const { data: conv } = await sb.from('conversations')
          .select('id').eq('business_id', task.business_id).eq('customer_id', p.customer_id)
          .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
        if (conv) {
          await sb.from('messages').insert({
            conversation_id: conv.id, business_id: task.business_id,
            direction: 'outbound', content: draft, content_type: 'text',
            status: 'sent', is_ai_generated: true,
            telegram_chat_id: recipientId, sent_at: new Date().toISOString(),
          }).then(() => {}, () => {});
        }
      }

      await tg(token, 'sendMessage', {
        chat_id: chatId, parse_mode: 'Markdown',
        text: `📤 Follow-up #${(p.attempt || 0) + 1} sent to *${target}*:\n\n_${draft}_`,
      });
    }

    // Re-arm for next interval
    const nextMs = INTERVAL_MS[p.interval] || INTERVAL_MS.daily;
    await sb.from('agent_tasks').update({
      status: 'pending',
      scheduled_at: new Date(Date.now() + nextMs).toISOString(),
      payload: { ...p, attempt: (p.attempt || 0) + 1, last_sent_at: new Date().toISOString(), message_draft: null },
    }).eq('id', task.id);

    return { ok: true, auto_sent: true };
  }

  // ── Standard approval path ────────────────────────────────────────────────
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
