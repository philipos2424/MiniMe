/**
 * orderExtractor — turns a customer message into a structured order.
 *
 * Uses gpt-4o in JSON mode. Given the business's product catalog and the
 * customer's message (which may be Amharic, English, or a mix), it returns:
 *   { is_order, items: [{ product_id, name, quantity }], confidence, notes }
 *
 * Then checkout.js turns that into a real Order row + Chapa link.
 */
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Quick regex pre-filter so we don't spend a gpt-4o call on "hi" / "how are you"
const ORDER_HINTS = /\b(want|buy|order|need|send|deliver|get|take|purchase|please|can i|i'll take|i will take)\b/i;
const ORDER_HINTS_AM = /(እፈልጋለሁ|እፈልጋ|እገዛ|እገዛለሁ|ላክ|ላኩልኝ|ስጠኝ|ይስጡኝ|ትእዛዝ|ግዛ|መግዛት|እወስዳለሁ|ዋጋ)/;
const QUANTITY_HINT = /\b\d+\s*(pcs?|pieces?|bottles?|bags?|kg|kilo|packs?|units?|boxes?|ቁጥር)\b|\b\d+\b/i;

function looksOrderLike(text) {
  if (!text || text.length < 3) return false;
  return ORDER_HINTS.test(text) || ORDER_HINTS_AM.test(text) || QUANTITY_HINT.test(text);
}

async function extractOrder(text, products, { recentMessages = [] } = {}) {
  if (!products?.length) return { is_order: false };
  if (!looksOrderLike(text)) return { is_order: false };

  const catalog = products.map(p => ({
    product_id: p.id,
    name: p.name,
    aliases: p.aliases || [],
    price: Number(p.selling_price ?? p.price ?? 0),
    currency: p.currency || 'ETB',
    unit: p.unit || 'unit',
    stock: p.stock_quantity ?? null,
  }));

  const context = recentMessages
    .slice(-6)
    .map(m => `${m.direction === 'inbound' ? 'customer' : 'business'}: ${m.content}`)
    .join('\n');

  const system = `You extract purchase orders from customer messages on a business chat bot.
The customer may write in Amharic, English, or mixed. Match their words to the product catalog loosely (fuzzy, case-insensitive, aliases, Amharic ↔ English).
Return strict JSON only. If the message is not an order (it's a question, greeting, complaint, etc.), return is_order=false.
Never invent products that aren't in the catalog. If the customer names something you can't match, set is_order=false and put the unmatched term in notes.`;

  const user = `CATALOG:
${JSON.stringify(catalog, null, 2)}

RECENT CONVERSATION:
${context || '(none)'}

CUSTOMER MESSAGE:
"""${text}"""

Return JSON:
{
  "is_order": boolean,
  "items": [{ "product_id": "uuid", "name": "product name", "quantity": number }],
  "confidence": number between 0 and 1,
  "notes": "short reason if is_order=false, or extra context like 'delivery requested'"
}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 400,
    });
    const parsed = JSON.parse(res.choices[0].message.content);

    // Validate — keep only items whose product_id matches the catalog
    const validItems = (parsed.items || [])
      .filter(it => catalog.some(c => c.product_id === it.product_id))
      .map(it => {
        const prod = catalog.find(c => c.product_id === it.product_id);
        const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
        return {
          product_id: prod.product_id,
          name: prod.name,
          quantity: qty,
          unit_price: prod.price,
          subtotal: Number((prod.price * qty).toFixed(2)),
          currency: prod.currency,
          stock_available: prod.stock,
        };
      });

    const is_order = !!(parsed.is_order && validItems.length > 0);

    return {
      is_order,
      items: validItems,
      confidence: Number(parsed.confidence) || 0,
      notes: parsed.notes || '',
    };
  } catch (e) {
    console.warn('extractOrder failed:', e.message);
    return { is_order: false };
  }
}

module.exports = { extractOrder, looksOrderLike };
