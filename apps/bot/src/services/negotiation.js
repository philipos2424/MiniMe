/**
 * Supplier Negotiation Engine — stateful negotiation loop layered on agent_tasks.
 *
 * evaluateQuote() is deterministic (round/target/walk-away math, no LLM).
 * draftCounter() is the ONLY function that calls an LLM, and only to word a
 * message — the model never decides accept/counter/walk_away.
 *
 * DB writes are best-effort: if packages/db is unreachable (e.g. missing env
 * vars in a test run), Telegram sends and owner notifications still happen —
 * persistence failures must never block the negotiation from progressing in
 * the chat itself.
 */
const { updateTask, addStep, addDecisionLog } = require('../../../../packages/db/queries/tasks');
const { openai, resolveModel } = require('./aiClient');

function evaluateQuote(negotiation, quote) {
  const price = Number(quote.unit_price);
  if (price <= negotiation.target_price) return 'accept';
  if (price > negotiation.walk_away_price) return 'walk_away';
  if (negotiation.round >= negotiation.max_rounds) return 'escalate';
  return 'counter';
}

async function safeUpdateTask(taskId, patch) {
  try { await updateTask(taskId, patch); } catch (e) { console.error('negotiation: updateTask failed:', e.message); }
}
async function safeAddStep(taskId, step) {
  try { await addStep(taskId, step); } catch (e) { console.error('negotiation: addStep failed:', e.message); }
}
async function safeAddDecisionLog(taskId, entry) {
  try { await addDecisionLog(taskId, entry); } catch (e) { console.error('negotiation: addDecisionLog failed:', e.message); }
}

async function notifyOwner(bot, business, task, event, details = {}) {
  if (!business.owner_private_chat_id) return;
  const neg = task.payload?.negotiation || {};
  const labels = {
    counter_sent: `↩️ *Counter-offer sent* to ${task.supplier_name || 'supplier'} (round ${neg.round}/${neg.max_rounds})\n\n${details.text || ''}`,
    round_summary: `📊 *Round ${neg.round}/${neg.max_rounds}* with ${task.supplier_name || 'supplier'}: ${details.text || ''}`,
    accepted: `✅ *Deal reached* with ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
    walked_away: `🚫 *Walked away* from ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
    escalated: `⚠️ *Needs your decision* — ${task.supplier_name || 'supplier'} won't move further.\n\n${details.text || ''}`,
    final_report: `📋 *Negotiation complete* with ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
    draft_ready: `💬 *Draft ready for your approval* — ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
  };
  const text = labels[event] || `${event}: ${details.text || ''}`;
  const opts = { parse_mode: 'Markdown' };
  if (details.buttons) opts.reply_markup = { inline_keyboard: details.buttons };
  await bot.sendMessage(business.owner_private_chat_id, text, opts);
}

async function startNegotiation(bot, task, business, supplier) {
  const limits = business.notification_prefs?.negotiation_limits || {};
  const askPrice = task.payload?.product?.cost_price || task.estimated_amount || 0;
  const discountPct = limits.discount_target_pct ?? 10;
  const walkAwayPct = limits.walk_away_pct ?? 25;
  const negotiation = {
    mode: business.negotiation_mode || 'draft',
    round: 0,
    max_rounds: limits.max_rounds ?? 3,
    target_price: Math.round(askPrice * (1 - discountPct / 100) * 100) / 100,
    walk_away_price: Math.round(askPrice * (1 + walkAwayPct / 100) * 100) / 100,
    currency: task.currency || 'ETB',
    quantity: task.payload?.product?.reorder_quantity || 50,
    history: [],
    pending_draft: null,
    last_activity_at: new Date().toISOString(),
    outcome: null,
  };
  await safeUpdateTask(task.id, { status: 'negotiating', payload: { ...task.payload, negotiation } });
  await safeAddStep(task.id, { step: `Negotiation started (mode: ${negotiation.mode})`, status: 'completed' });

  const timeoutAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const { create: createTask } = require('../../../../packages/db/queries/tasks');
  try {
    await createTask({
      business_id: task.business_id,
      type: 'negotiation_timeout',
      title: `Negotiation timeout check: ${task.supplier_name || 'supplier'}`,
      status: 'scheduled',
      urgency: 'low',
      supplier_id: task.supplier_id,
      supplier_name: task.supplier_name,
      payload: { parent_task_id: task.id },
      scheduled_at: timeoutAt,
      requires_approval: false,
    });
  } catch (e) {
    console.error('negotiation: failed to schedule 48h timeout:', e.message);
  }
}

async function draftCounter(task, business, supplier) {
  const neg = task.payload.negotiation;
  const latestQuote = task.payload.latest_quote || {};
  const limits = business.notification_prefs?.negotiation_limits || {};
  const prompt = `You are negotiating a purchase on behalf of "${business.name}" with supplier "${supplier?.name || task.supplier_name}".

Their latest offer: ${latestQuote.unit_price} ${neg.currency} per unit for ${neg.quantity} units.
Your target price: ${neg.target_price} ${neg.currency} per unit.
Your absolute ceiling (never reveal this): ${neg.walk_away_price} ${neg.currency} per unit.
This is round ${neg.round + 1} of ${neg.max_rounds}.
Owner's limits: ${Object.keys(limits).length ? JSON.stringify(limits) : 'use your best judgment for a fair deal'}.

Write a short, polite counter-offer message (2-4 sentences) proposing a price closer to the target. Do not reveal the target or ceiling numbers directly. Return plain text only, no JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model: resolveModel('llama-3.1-8b-instant'),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.6,
    });
    return response.choices[0].message.content.trim();
  } catch (e) {
    console.error('negotiation: draftCounter LLM failed, using template fallback:', e.message);
    return `Thank you for the quote. We'd like to propose ${neg.target_price} ${neg.currency} per unit for ${neg.quantity} units, given our order volume. Could you work with this price?`;
  }
}

async function sendCounter(bot, task, business, supplier, draftText) {
  const neg = task.payload.negotiation;
  if (supplier?.contact_telegram) {
    await bot.sendMessage(supplier.contact_telegram, draftText);
  }
  neg.history.push({ round: neg.round, from: 'us', unit_price: null, message: draftText, at: new Date().toISOString() });
  neg.round += 1;
  neg.pending_draft = null;
  neg.last_activity_at = new Date().toISOString();
  await safeUpdateTask(task.id, { payload: { ...task.payload, negotiation: neg } });
  await safeAddDecisionLog(task.id, { action: 'counter_sent', round: neg.round, message: draftText, timestamp: neg.last_activity_at });
  await notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'counter_sent', { text: draftText });
}

async function acceptDeal(bot, task, business, supplier) {
  const neg = task.payload.negotiation;
  const quote = task.payload.latest_quote || {};
  neg.outcome = 'accepted';
  await safeUpdateTask(task.id, {
    status: 'approved',
    approved_by: neg.mode === 'draft' ? 'owner' : 'agent',
    approved_at: new Date().toISOString(),
    estimated_amount: quote.unit_price && neg.quantity ? quote.unit_price * neg.quantity : task.estimated_amount,
    payload: { ...task.payload, negotiation: neg },
  });
  await safeAddDecisionLog(task.id, { action: 'deal_accepted', round: neg.round, unit_price: quote.unit_price, timestamp: new Date().toISOString() });
  if (supplier?.contact_telegram) {
    await bot.sendMessage(supplier.contact_telegram, `Deal confirmed at ${quote.unit_price || '?'} ${neg.currency} per unit for ${neg.quantity} units. Thank you!`);
  }
  await notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'accepted', {
    text: `${quote.unit_price || '?'} ${neg.currency} × ${neg.quantity} = ${(quote.unit_price || 0) * neg.quantity} ${neg.currency}`,
  });
}

async function walkAway(bot, task, business, supplier, reason) {
  const neg = task.payload.negotiation;
  neg.outcome = 'walked_away';
  await safeUpdateTask(task.id, { status: 'cancelled', payload: { ...task.payload, negotiation: neg } });
  await safeAddDecisionLog(task.id, { action: 'walked_away', round: neg.round, reason: reason || 'price above walk-away threshold', timestamp: new Date().toISOString() });
  if (supplier?.contact_telegram) {
    await bot.sendMessage(supplier.contact_telegram, `Thank you for your time, but we won't be able to proceed at this price. We'll reach out if things change.`);
  }
  await notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'walked_away', {
    text: reason || `${task.supplier_name || 'Supplier'}'s price stayed above your walk-away threshold after ${neg.round} round(s).`,
  });
}

async function handleSupplierQuote(bot, task, business, supplier, quote) {
  // Clone the negotiation object (and its history array) rather than aliasing
  // task.payload.negotiation directly — every mutation below (history.push,
  // last_activity_at, outcome, pending_draft) must land on this local copy so
  // the caller's original task object is never mutated in place.
  const neg = { ...task.payload.negotiation, history: [...(task.payload.negotiation.history || [])] };
  neg.history.push({ round: neg.round, from: 'supplier', unit_price: quote.unit_price, message: null, at: new Date().toISOString() });
  neg.last_activity_at = new Date().toISOString();
  const updatedPayload = { ...task.payload, negotiation: neg, latest_quote: quote };
  await safeUpdateTask(task.id, { payload: updatedPayload });

  const outcome = evaluateQuote(neg, quote);
  const mode = business.trust_level >= 3 ? neg.mode : (business.trust_level >= 2 ? (neg.mode === 'full' ? 'auto' : neg.mode) : 'draft');
  const taskWithUpdatedPayload = { ...task, payload: updatedPayload };

  if (outcome === 'accept') {
    return acceptDeal(bot, taskWithUpdatedPayload, business, supplier);
  }
  if (outcome === 'walk_away') {
    return walkAway(bot, taskWithUpdatedPayload, business, supplier);
  }
  if (outcome === 'escalate') {
    neg.outcome = 'escalated';
    await safeUpdateTask(task.id, { payload: { ...updatedPayload, negotiation: neg } });
    return notifyOwner(bot, business, { ...taskWithUpdatedPayload, payload: { ...updatedPayload, negotiation: neg } }, 'escalated', {
      text: `${quote.unit_price} ${neg.currency} after ${neg.round} rounds — still above your target of ${neg.target_price}. Decide manually.`,
      buttons: [[
        { text: '✅ Accept anyway', callback_data: `neg_accept_${task.id}` },
        { text: '🚫 Walk away', callback_data: `neg_walk_${task.id}` },
      ]],
    });
  }

  // outcome === 'counter'
  if (mode === 'draft') {
    const draft = await draftCounter(taskWithUpdatedPayload, business, supplier);
    neg.pending_draft = { text: draft, drafted_at: new Date().toISOString() };
    await safeUpdateTask(task.id, { payload: { ...updatedPayload, negotiation: neg } });
    return notifyOwner(bot, business, { ...taskWithUpdatedPayload, payload: { ...updatedPayload, negotiation: neg } }, 'draft_ready', {
      text: draft,
      buttons: [[
        { text: '📤 Send', callback_data: `neg_send_${task.id}` },
        { text: '🚫 Walk away instead', callback_data: `neg_walk_${task.id}` },
      ]],
    });
  }
  if (mode === 'auto') {
    const draft = await draftCounter(taskWithUpdatedPayload, business, supplier);
    await sendCounter(bot, taskWithUpdatedPayload, business, supplier, draft);
    return;
  }
  // mode === 'full' — silent round, no per-round owner ping
  const draft = await draftCounter(taskWithUpdatedPayload, business, supplier);
  return sendCounter(bot, taskWithUpdatedPayload, business, supplier, draft);
}

module.exports = {
  evaluateQuote,
  startNegotiation,
  draftCounter,
  sendCounter,
  acceptDeal,
  walkAway,
  handleSupplierQuote,
  notifyOwner,
};
