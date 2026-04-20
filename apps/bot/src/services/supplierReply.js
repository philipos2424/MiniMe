/**
 * When a supplier replies to a reorder task (currently Telegram-only —
 * personal email inbound would need a webhook), we try to parse the
 * structured info (price, lead time, MOQ, payment terms, currency) and
 * attach it to the most recent pending supply_reorder task.
 *
 * Then we ack the supplier briefly and DM the owner a clean summary.
 */
const OpenAI = require('openai');
const { supabase } = require('../../../../packages/db/client');
const { findByTelegram: findSupplierByTelegram, update: updateSupplier } = require('../../../../packages/db/queries/suppliers');
const { findById: findTask, updateTask, addStep, addDecisionLog } = require('../../../../packages/db/queries/tasks');

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

/**
 * Look up the most recent supply_reorder task this supplier might be replying to.
 * Matches by business + supplier name, in executing/completed/awaiting_approval in the last 30 days.
 */
async function findLatestReorderTask(businessId, supplierName) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('business_id', businessId)
    .eq('type', 'supply_reorder')
    .eq('supplier_name', supplierName)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  return (data && data[0]) || null;
}

/**
 * Parse a supplier's freeform reply into structured quote data.
 * Returns { unit_price, currency, quantity, lead_time_days, moq, payment_terms,
 *           incoterms, available, notes, confidence }
 */
async function parseSupplierQuote(replyText, context = {}) {
  const prompt = `You are extracting a quotation from a supplier's reply. The supplier may write in English, Chinese, Amharic, or mix. Be lenient — extract only what's clearly stated. Do NOT invent values.

Context (what we asked them about):
- Product: ${context.productName || '(unknown)'}
- Quantity requested: ${context.requestedQty || '(unknown)'}
- Currency we expected: ${context.currency || 'USD'}

Supplier's reply:
"""
${replyText}
"""

Return ONLY valid JSON with this shape (use null for anything not clearly stated):
{
  "unit_price": number | null,
  "currency": "USD" | "EUR" | "CNY" | "ETB" | "GBP" | null,
  "quantity": number | null,
  "lead_time_days": number | null,
  "moq": number | null,
  "payment_terms": string | null,
  "incoterms": "FOB" | "CIF" | "EXW" | "DDP" | "DAP" | "CFR" | null,
  "available": true | false | null,
  "delivery_date": string | null,
  "notes": string | null,
  "confidence": 0.0 to 1.0
}

Rules:
- Convert "7 days" → 7, "3 weeks" → 21, "1 month" → 30.
- "$12.50" → unit_price: 12.5, currency: "USD". "¥80" → currency: "CNY".
- If they say "out of stock", "unavailable", "cannot supply" → available: false.
- If they ask a clarifying question with no numbers → all fields null, confidence ≤ 0.2, notes: brief summary.
- confidence reflects how complete & clear the quote is.`;

  try {
    const resp = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    return JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    console.error('parseSupplierQuote error:', e.message);
    return { confidence: 0, notes: 'Parser failed', error: e.message };
  }
}

/**
 * Main entry — called from message.js when a message arrives from a known supplier.
 * Returns true if we handled it (caller should stop processing), false otherwise.
 */
async function handleSupplierReply(bot, msg, senderTelegramId) {
  try {
    const supplier = await findSupplierByTelegram(senderTelegramId);
    if (!supplier) return false;

    // Find the most recent reorder task for this supplier
    const task = await findLatestReorderTask(supplier.business_id, supplier.name);
    const replyText = msg.text || '';

    // Get business so we can DM the owner
    const { findById: findBusinessById } = require('../../../../packages/db/queries/businesses');
    const business = await findBusinessById(supplier.business_id);
    if (!business) return false;

    // Parse the quote
    const productName = task?.payload?.product?.name || null;
    const quote = await parseSupplierQuote(replyText, {
      productName,
      requestedQty: supplier.min_order_quantity || 50,
      currency: supplier.currency || 'USD',
    });

    // Attach to task (if one exists)
    if (task) {
      await addDecisionLog(task.id, {
        action: 'supplier_reply_received',
        raw_reply: replyText.slice(0, 2000),
        parsed_quote: quote,
        supplier_id: supplier.id,
        timestamp: new Date().toISOString(),
      });
      await addStep(task.id, { step: 'Supplier replied with quote', status: 'completed' });

      // Store the parsed quote in the task payload for easy access
      const existingPayload = task.payload || {};
      await updateTask(task.id, {
        payload: {
          ...existingPayload,
          latest_quote: quote,
          latest_quote_at: new Date().toISOString(),
        },
        status: quote.confidence >= 0.5 && (quote.unit_price || quote.available === false)
          ? 'awaiting_approval'  // owner should review the quote
          : task.status,
      });
    }

    // Update supplier reliability — any reply counts as responsive (light bump)
    const newScore = Math.min(1, (supplier.reliability_score || 0.5) + 0.02);
    await updateSupplier(supplier.id, { reliability_score: newScore });

    // ---- Ack the supplier in their language ----
    const supplierLang = supplier.language || (supplier.is_international ? 'en' : 'am');
    const ack = supplierLang === 'am'
      ? 'አመሰግናለሁ! መልዕክቶን ደርሶኛል፣ እገመግማለሁ።'
      : supplierLang === 'zh'
      ? '谢谢！已收到您的信息，我会查看并尽快回复。'
      : 'Thank you! I\'ve received your message and will review it shortly.';
    try { await bot.sendMessage(msg.chat.id, ack); } catch (_) {}

    // ---- DM the owner a clean summary ----
    if (business.owner_private_chat_id) {
      const lines = [
        `📨 *Quote from ${supplier.name}* ${supplier.is_international ? '🌍' : '🇪🇹'}`,
        task ? `_For task:_ ${task.title || task.description || '(reorder)'}` : '_(no matching reorder task — saved supplier reply)_',
        '',
      ];
      if (quote.available === false) {
        lines.push('❌ *Not available* — they can\'t supply this order.');
      } else {
        if (quote.unit_price != null) lines.push(`💰 *Unit price:* ${quote.unit_price} ${quote.currency || supplier.currency || 'USD'}`);
        if (quote.quantity != null) lines.push(`📦 *For quantity:* ${quote.quantity}`);
        if (quote.moq != null) lines.push(`📦 *MOQ:* ${quote.moq}`);
        if (quote.lead_time_days != null) lines.push(`🚚 *Lead time:* ${quote.lead_time_days} days`);
        if (quote.delivery_date) lines.push(`📅 *Delivery by:* ${quote.delivery_date}`);
        if (quote.payment_terms) lines.push(`💳 *Payment:* ${quote.payment_terms}`);
        if (quote.incoterms) lines.push(`📑 *Incoterms:* ${quote.incoterms}`);
        if (quote.notes) lines.push(`📝 _${quote.notes}_`);

        // Total estimate
        if (quote.unit_price != null && (quote.quantity || supplier.min_order_quantity)) {
          const qty = quote.quantity || supplier.min_order_quantity;
          const total = quote.unit_price * qty;
          lines.push(`\n💵 *Estimated total:* ${total.toLocaleString()} ${quote.currency || supplier.currency || 'USD'} (${qty} × ${quote.unit_price})`);
        }
      }

      lines.push('', `_Confidence: ${Math.round((quote.confidence || 0) * 100)}%_`);
      lines.push('', '*Raw reply:*', `"${replyText.slice(0, 500)}${replyText.length > 500 ? '…' : ''}"`);

      // Action buttons if there's a task + confident quote
      const opts = { parse_mode: 'Markdown' };
      if (task && quote.confidence >= 0.5 && quote.available !== false && quote.unit_price != null) {
        opts.reply_markup = {
          inline_keyboard: [
            [
              { text: '✅ Approve & proceed', callback_data: `quote_approve_${task.id}` },
              { text: '❌ Decline', callback_data: `quote_decline_${task.id}` },
            ],
            [{ text: '💬 Negotiate (draft a reply)', callback_data: `quote_negotiate_${task.id}` }],
          ],
        };
      }

      await bot.sendMessage(business.owner_private_chat_id, lines.join('\n'), opts);
    }

    return true;
  } catch (e) {
    console.error('handleSupplierReply error:', e);
    return false;
  }
}

module.exports = { handleSupplierReply, parseSupplierQuote };
