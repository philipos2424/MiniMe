import { observeDelivery } from './deliveryOutcome.mjs';

const INTERVAL_MS = {
  every_6h: 6 * 3600000,
  daily: 24 * 3600000,
  every_2d: 48 * 3600000,
  weekly: 7 * 24 * 3600000,
};

/**
 * Claim a scheduled send before touching Telegram. An interrupted or uncertain
 * send remains outside the pending-task scan until a person reconciles it.
 * Provider success and scheduler/database success are separate observations.
 */
export async function sendScheduledFollowUp({ sb, send, business, task, draft, now = Date.now, timeoutMs }) {
  const p = task.payload || {};
  if (task.status !== 'pending' || !task.scheduled_at) return { ok: false, skipped: 'not_pending' };
  const attemptedAt = new Date(now()).toISOString();
  const ownerChat = business.owner_private_chat_id || business.owner_telegram_id;
  const notifyOwner = text => observeDelivery(
    () => send({ chat_id: ownerChat, text }), { timeoutMs },
  );
  const claim = await sb.from('agent_tasks').update({
    status: 'in_progress',
    payload: { ...p, delivery_attempt: { outcome: 'in_progress', attempted_at: attemptedAt }, message_draft: draft },
  }).eq('id', task.id).eq('business_id', task.business_id)
    .eq('status', 'pending').eq('scheduled_at', task.scheduled_at).select('id').maybeSingle();
  if (claim.error) return { ok: false, error: 'claim_failed' };
  if (!claim.data) return { ok: false, skipped: 'already_claimed' };

  const delivery = await observeDelivery(() => send({
    chat_id: p.recipient_tg_id, text: draft,
    ...(business.telegram_biz_conn_id && { business_connection_id: business.telegram_biz_conn_id }),
  }), { timeoutMs });
  const receipt = { ...delivery, attempted_at: attemptedAt };

  if (!delivery.ok) {
    const result = await sb.from('agent_tasks').update({
      status: delivery.outcome === 'unknown' ? 'blocked' : 'failed',
      payload: { ...p, message_draft: draft, delivery_attempt: receipt },
    }).eq('id', task.id).eq('business_id', task.business_id).eq('status', 'in_progress');
    await notifyOwner(delivery.outcome === 'unknown'
      ? `⚠️ I couldn't confirm whether the follow-up to ${p.target} was delivered. I've stopped automatic sends for this task. Check the conversation before retrying.`
      : `⚠️ The follow-up to ${p.target} was rejected: ${delivery.error}. I've stopped this task so you can fix the delivery issue.`);
    return {
      ok: false, auto_sent: false, delivery_outcome: delivery.outcome,
      error: result.error ? 'outcome_save_failed' : delivery.error,
    };
  }

  // Save the receipt and next occurrence before best-effort logging/owner DM.
  // If this update fails, the durable in_progress claim blocks blind retries.
  const sentAt = new Date(now()).toISOString();
  const saved = await sb.from('agent_tasks').update({
    status: 'pending',
    scheduled_at: new Date(now() + (INTERVAL_MS[p.interval] || INTERVAL_MS.daily)).toISOString(),
    payload: { ...p, attempt: (p.attempt || 0) + 1, last_sent_at: sentAt, message_draft: null, delivery_attempt: receipt },
  }).eq('id', task.id).eq('business_id', task.business_id).eq('status', 'in_progress');
  if (saved.error) {
    await notifyOwner(`⚠️ The follow-up to ${p.target} was delivered, but I couldn't save its next run. Automatic follow-ups are stopped; check this task before restarting it.`);
    return { ok: false, auto_sent: true, delivery_outcome: 'sent', error: 'outcome_save_failed' };
  }

  if (p.customer_id) {
    try {
      const { data: conv } = await sb.from('conversations')
        .select('id').eq('business_id', task.business_id).eq('customer_id', p.customer_id)
        .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
      if (conv) await sb.from('messages').insert({
        conversation_id: conv.id, business_id: task.business_id,
        direction: 'outbound', content: draft, content_type: 'text',
        status: 'sent', is_ai_generated: true,
        telegram_chat_id: p.recipient_tg_id, sent_at: sentAt,
      });
    } catch { /* the task receipt already records the confirmed send */ }
  }
  await notifyOwner(`📤 Follow-up #${(p.attempt || 0) + 1} sent to ${p.target}:\n\n${draft}`);
  return { ok: true, auto_sent: true, delivery_outcome: 'sent' };
}
