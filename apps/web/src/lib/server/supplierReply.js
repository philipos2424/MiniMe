/**
 * Supplier-reply quote parser for the webhook reply engine.
 *
 * Ported from apps/bot/src/services/supplierReply.js. Uses service-role supabase
 * directly (no cross-package queries) and the raw Bot API instead of a bot instance.
 */
import OpenAI from 'openai';
import { MODEL } from './constants';
import { supabase } from './db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function findSupplierByTelegram(telegramId) {
  const { data } = await supabase()
    .from('suppliers')
    .select('*')
    .eq('contact_telegram', telegramId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return data;
}

async function findLatestReorderTask(businessId, supplierName) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await supabase()
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

export async function parseSupplierQuote(replyText, context = {}) {
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
- If they say "out of stock"/"unavailable" → available: false.
- If they ask a clarifying question with no numbers → all fields null, confidence ≤ 0.2.`;

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    return JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    console.error('parseSupplierQuote:', e.message);
    return { confidence: 0, notes: 'Parser failed', error: e.message };
  }
}

/**
 * Returns true if we handled the message (caller should stop).
 */
export async function handleSupplierReply(token, business, msg, senderTelegramId) {
  try {
    const supplier = await findSupplierByTelegram(senderTelegramId);
    if (!supplier || supplier.business_id !== business.id) return false;

    const replyText = msg.text || '';
    const task = await findLatestReorderTask(business.id, supplier.name);
    const productName = task?.payload?.product?.name || null;

    const quote = await parseSupplierQuote(replyText, {
      productName,
      requestedQty: supplier.min_order_quantity || 50,
      currency: supplier.currency || 'USD',
    });

    if (task) {
      const existing = task.payload || {};
      await supabase().from('agent_tasks').update({
        payload: { ...existing, latest_quote: quote, latest_quote_at: new Date().toISOString() },
        status: quote.confidence >= 0.5 && (quote.unit_price || quote.available === false)
          ? 'awaiting_approval' : task.status,
      }).eq('id', task.id);
    }

    // Supplier reliability bump
    const newScore = Math.min(1, (supplier.reliability_score || 0.5) + 0.02);
    await supabase().from('suppliers').update({ reliability_score: newScore }).eq('id', supplier.id);

    // Ack supplier in their language
    const lang = supplier.language || (supplier.is_international ? 'en' : 'am');
    const ack = lang === 'am'
      ? 'አመሰግናለሁ! መልዕክቶን ደርሶኛል፣ እገመግማለሁ።'
      : lang === 'zh'
      ? '谢谢！已收到您的信息，我会查看并尽快回复。'
      : "Thank you! I've received your message and will review it shortly.";
    await tg(token, 'sendMessage', { chat_id: msg.chat.id, text: ack });

    // DM owner summary with actions
    if (business.owner_private_chat_id) {
      const lines = [
        `📨 *Quote from ${supplier.name}* ${supplier.is_international ? '🌍' : '🇪🇹'}`,
        task ? `_For task:_ ${task.title || task.description || '(reorder)'}` : '_(no matching reorder task)_',
        '',
      ];
      if (quote.available === false) {
        lines.push("❌ *Not available* — they can't supply this order.");
      } else {
        if (quote.unit_price != null) lines.push(`💰 *Unit price:* ${quote.unit_price} ${quote.currency || supplier.currency || 'USD'}`);
        if (quote.quantity != null) lines.push(`📦 *For quantity:* ${quote.quantity}`);
        if (quote.moq != null) lines.push(`📦 *MOQ:* ${quote.moq}`);
        if (quote.lead_time_days != null) lines.push(`🚚 *Lead time:* ${quote.lead_time_days} days`);
        if (quote.delivery_date) lines.push(`📅 *Delivery by:* ${quote.delivery_date}`);
        if (quote.payment_terms) lines.push(`💳 *Payment:* ${quote.payment_terms}`);
        if (quote.incoterms) lines.push(`📑 *Incoterms:* ${quote.incoterms}`);
        if (quote.notes) lines.push(`📝 _${quote.notes}_`);

        if (quote.unit_price != null && (quote.quantity || supplier.min_order_quantity)) {
          const qty = quote.quantity || supplier.min_order_quantity;
          const total = quote.unit_price * qty;
          lines.push(`\n💵 *Estimated total:* ${total.toLocaleString()} ${quote.currency || supplier.currency || 'USD'} (${qty} × ${quote.unit_price})`);
        }
      }
      lines.push('', `_Confidence: ${Math.round((quote.confidence || 0) * 100)}%_`);
      lines.push('', '*Raw reply:*', `"${replyText.slice(0, 500)}${replyText.length > 500 ? '…' : ''}"`);

      const body = {
        chat_id: business.owner_private_chat_id,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
      };
      if (task && quote.confidence >= 0.5 && quote.available !== false && quote.unit_price != null) {
        body.reply_markup = {
          inline_keyboard: [
            [
              { text: '✅ Approve & proceed', callback_data: `quote_approve_${task.id}` },
              { text: '❌ Decline', callback_data: `quote_decline_${task.id}` },
            ],
            [{ text: '💬 Negotiate', callback_data: `quote_negotiate_${task.id}` }],
          ],
        };
      }
      await tg(token, 'sendMessage', body);
    }

    return true;
  } catch (e) {
    console.error('handleSupplierReply:', e);
    return false;
  }
}
