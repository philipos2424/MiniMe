const OpenAI = require('openai');
const { supabase } = require('../../../../packages/db/client');
const { create: createTask, updateTask } = require('../../../../packages/db/queries/tasks');
const { findAll: findAllBusinesses, findByOwnerTelegramId } = require('../../../../packages/db/queries/businesses');
const { findByBusiness: findConversations } = require('../../../../packages/db/queries/conversations');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Parse a natural-language time expression into an ISO timestamp.
 * Examples: "in 30 minutes", "tomorrow 9am", "Friday 2pm", "at 18:00"
 */
async function parseWhen(expr, nowIso = new Date().toISOString()) {
  try {
    const prompt = `Extract the target timestamp from this expression. Current time (UTC): ${nowIso}.
Expression: """${expr}"""
Return ONLY valid JSON: {"iso":"<ISO-8601 timestamp in UTC>","assumed_timezone":"EAT|UTC","confidence":0-1}
If the user says a time without a date (e.g. "9am"), assume the NEXT occurrence in Africa/Addis_Ababa (UTC+3).`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    if (parsed.iso && !isNaN(new Date(parsed.iso).getTime())) return parsed.iso;
  } catch (e) {
    console.warn('parseWhen failed:', e.message);
  }
  return null;
}

/**
 * Create a reminder task for the owner.
 */
async function createReminder({ businessId, whenIso, text, customerId = null }) {
  return createTask({
    business_id: businessId,
    type: 'reminder',
    status: 'scheduled',
    scheduled_at: whenIso,
    customer_id: customerId,
    description: text,
    context: { text },
  });
}

/**
 * Create a follow-up to a customer (AI will draft when it fires).
 */
async function createFollowUp({ businessId, customerId, whenIso, reason }) {
  return createTask({
    business_id: businessId,
    type: 'followup',
    status: 'scheduled',
    scheduled_at: whenIso,
    customer_id: customerId,
    description: reason,
    context: { reason },
  });
}

/**
 * Create an owner-authored scheduled message (sent to a customer at time X).
 */
async function createScheduledMessage({ businessId, customerId, whenIso, message }) {
  return createTask({
    business_id: businessId,
    type: 'scheduled_message',
    status: 'scheduled',
    scheduled_at: whenIso,
    customer_id: customerId,
    description: `Send: ${message.slice(0, 80)}`,
    context: { message },
  });
}

/**
 * Fires any due scheduled tasks. Called by cron every minute or so.
 * Requires a bot instance to actually send Telegram messages.
 */
async function fireDueTasks(bot) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .in('type', ['reminder', 'followup', 'scheduled_message', 'briefing'])
    .limit(50);

  if (error) { console.error('fireDueTasks query error:', error); return 0; }
  if (!due || !due.length) return 0;

  let fired = 0;
  for (const task of due) {
    try {
      await updateTask(task.id, { status: 'executing', fired_at: nowIso });
      await executeTask(bot, task);
      await updateTask(task.id, { status: 'completed' });
      fired++;
    } catch (err) {
      console.error(`Task ${task.id} fire error:`, err);
      await updateTask(task.id, { status: 'failed', error: err.message });
    }
  }
  return fired;
}

async function executeTask(bot, task) {
  const { supabase: sb } = require('../../../../packages/db/client');
  const { data: business } = await sb.from('businesses').select('*').eq('id', task.business_id).single();
  if (!business) throw new Error('Business not found');
  const ownerChat = business.owner_private_chat_id;

  if (task.type === 'reminder') {
    const text = (task.context && task.context.text) || task.description || 'Reminder';
    if (ownerChat) await bot.sendMessage(ownerChat, `⏰ Reminder: ${text}`);
    return;
  }

  if (task.type === 'scheduled_message') {
    const customerId = task.customer_id;
    const text = task.context?.message || task.description;
    if (!customerId || !text) return;
    const { data: customer } = await sb.from('customers').select('*').eq('id', customerId).single();
    if (customer?.telegram_id) {
      await bot.sendMessage(customer.telegram_id, text);
    }
    if (ownerChat) await bot.sendMessage(ownerChat, `📤 Sent scheduled message to ${customer?.name || 'customer'}:\n"${text}"`);
    return;
  }

  if (task.type === 'followup' || task.type === 'customer_followup' || task.type === 'payment_followup' || task.type === 'supply_reorder') {
    // Delegate to the real agent executor — it drafts + sends (or queues) appropriately.
    const { executeTask: agentExecute } = require('./agent');
    await agentExecute(bot, task.id);
    return;
  }

  if (task.type === 'briefing') {
    await sendMorningBriefing(bot, business);
    return;
  }
}

/**
 * Generate and send the morning briefing — what needs attention today.
 */
async function sendMorningBriefing(bot, business) {
  if (!business.owner_private_chat_id) return;
  try {
    const conversations = await findConversations(business.id, { limit: 20 });
    const now = Date.now();
    const needsReply = (conversations || []).filter(c => c.requires_owner || c.last_ai_action === 'escalated');
    const vips = (conversations || []).filter(c => c.customers?.tier === 'vip');
    const stale = (conversations || []).filter(c => {
      if (!c.last_message_at) return false;
      const age = (now - new Date(c.last_message_at).getTime()) / 3600000;
      return age > 24 && c.status === 'active';
    });

    const { data: scheduled } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('business_id', business.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString())
      .lte('scheduled_at', new Date(Date.now() + 24 * 3600 * 1000).toISOString())
      .order('scheduled_at', { ascending: true });

    const lines = [
      `☀️ Morning, ${business.owner_name || 'boss'}! Here's your briefing for ${business.name}:`,
      ``,
      `🔔 Needs your reply: ${needsReply.length}`,
      `⭐ VIPs active: ${vips.length}`,
      `🕸 Stale threads (>24h): ${stale.length}`,
      `📅 Scheduled today: ${(scheduled || []).length}`,
    ];

    if (needsReply.length) {
      lines.push('', '*Top 3 to answer:*');
      needsReply.slice(0, 3).forEach((c, i) => {
        lines.push(`${i + 1}. ${c.customers?.name || 'Unknown'} — ${c.last_ai_action || 'waiting'}`);
      });
    }

    if ((scheduled || []).length) {
      lines.push('', '*Today\'s schedule:*');
      scheduled.slice(0, 5).forEach(s => {
        const t = new Date(s.scheduled_at).toISOString().slice(11, 16);
        lines.push(`• ${t} UTC — ${s.description || s.type}`);
      });
    }

    lines.push('', 'Type /advisor who should I reply to first? for a ranked triage.');

    await bot.sendMessage(business.owner_private_chat_id, lines.join('\n'));
  } catch (e) {
    console.error('sendMorningBriefing error:', e);
  }
}

async function sendBriefingsToAll(bot) {
  const all = await findAllBusinesses();
  let sent = 0;
  for (const b of all || []) {
    if (b.panic_mode) continue;
    if (!b.owner_private_chat_id) continue;
    await sendMorningBriefing(bot, b);
    sent++;
  }
  return sent;
}

module.exports = {
  parseWhen,
  createReminder,
  createFollowUp,
  createScheduledMessage,
  fireDueTasks,
  sendMorningBriefing,
  sendBriefingsToAll,
};
