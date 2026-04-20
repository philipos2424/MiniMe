/**
 * checkout — the "customer wants to buy" pipeline.
 *
 *   tryCheckout(bot, business, customer, conversation, msg, intent)
 *     → if the message parses as an order, creates the Order, generates a
 *       Chapa payment link, replies to the customer with it in their language,
 *       DMs the owner, and returns true so the caller skips the normal draft flow.
 *
 * The callback (webhook) in apps/web then marks the order paid and notifies both sides.
 */
const axios = require('axios');
const { extractOrder } = require('./orderExtractor');
const { findByBusiness: findProducts } = require('../../../../packages/db/queries/products');
const { getRecentMessages, createMessage } = require('../../../../packages/db/queries/messages');
const { create: createOrder, update: updateOrder } = require('../../../../packages/db/queries/orders');

function amharicOrderConfirmation(business, items, total, currency, url) {
  const lines = items.map(it => `• ${it.quantity} × ${it.name} = ${it.subtotal.toLocaleString()} ${currency}`).join('\n');
  return `እሺ፣ ትእዛዝዎን ተቀብያለሁ 🙏

${lines}

*ጠቅላላ: ${total.toLocaleString()} ${currency}*

💳 በአስተማማኝ መንገድ ለመክፈል ይህንን ይጫኑ:
${url}

ከተከፈለ በኋላ ${business.name} ወዲያውኑ ያውቃሉ።`;
}

function englishOrderConfirmation(business, items, total, currency, url) {
  const lines = items.map(it => `• ${it.quantity} × ${it.name} = ${it.subtotal.toLocaleString()} ${currency}`).join('\n');
  return `Got it — here's your order:

${lines}

*Total: ${total.toLocaleString()} ${currency}*

💳 Tap to pay securely:
${url}

${business.name} will be notified the moment payment is confirmed.`;
}

async function generateChapaLink({ business, customer, order, items, total, currency }) {
  if (!process.env.CHAPA_SECRET_KEY) return null;
  const txRef = `order-${business.id.slice(0, 8)}-${order.id.slice(0, 8)}-${Date.now()}`;

  const firstItem = items[0]?.name || 'order';
  const res = await axios.post(
    'https://api.chapa.co/v1/transaction/initialize',
    {
      amount: Number(total).toFixed(2),
      currency,
      email: customer?.email || `customer-${customer?.id || 'x'}@minime.app`,
      first_name: (customer?.name || 'Customer').split(' ')[0] || 'Customer',
      last_name: (customer?.name || '').split(' ').slice(1).join(' ') || 'Order',
      tx_ref: txRef,
      return_url: `${process.env.WEB_URL || 'https://minime.app'}/thanks`,
      callback_url: `${process.env.WEB_URL || process.env.BASE_URL}/api/payment/callback`,
      customization: {
        title: (business.name || 'MiniMe').slice(0, 16),
        description: `${items.length === 1 ? firstItem : items.length + ' items'}`.slice(0, 50),
      },
    },
    { headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` }, timeout: 10000 }
  );

  return { url: res.data?.data?.checkout_url || null, txRef };
}

async function notifyOwnerNewOrder(bot, business, customer, order, items, total, currency) {
  const ownerChat = business.owner_private_chat_id;
  if (!ownerChat) return;
  const lines = items.map(it => `  • ${it.quantity} × ${it.name} = ${it.subtotal.toLocaleString()} ${currency}`).join('\n');
  const text = `🛒 *New order — awaiting payment*

*${customer?.name || 'Customer'}*${customer?.telegram_username ? ` (@${customer.telegram_username})` : ''}

${lines}

*Total: ${total.toLocaleString()} ${currency}*

I've sent them a Chapa link. You'll get a ding when they pay.`;
  try {
    await bot.sendMessage(ownerChat, text, { parse_mode: 'Markdown' });
  } catch (e) { console.warn('notifyOwnerNewOrder failed:', e.message); }
}

/**
 * Main entry. Returns true if we handled the message as an order, false otherwise.
 */
async function tryCheckout(bot, business, customer, conversation, savedMessage, intent) {
  try {
    if (business.panic_mode) return false;

    const products = await findProducts(business.id);
    if (!products.length) return false;

    const recentMessages = await getRecentMessages(conversation.id, 6);
    const extracted = await extractOrder(savedMessage.content, products, { recentMessages });

    if (!extracted.is_order || !extracted.items?.length) return false;
    if (extracted.confidence < 0.55) return false;

    // Stock check — if any item is out of stock, don't create an order; let the normal
    // reply flow handle it (the agent will explain politely).
    const oos = extracted.items.find(it =>
      it.stock_available !== null && it.stock_available !== undefined && it.stock_available < it.quantity
    );
    if (oos) {
      // Tell the customer + hand control back to normal reply path
      const isAmharic = /[\u1200-\u137F]/.test(savedMessage.content);
      const out = isAmharic
        ? `ይቅርታ፣ በአሁኑ ጊዜ ${oos.name} በቂ የለም። (ያለው: ${oos.stock_available || 0})`
        : `Sorry, we don't have enough ${oos.name} in stock right now. (Available: ${oos.stock_available || 0})`;
      await bot.sendMessage(savedMessage.telegram_chat_id, out, {
        reply_to_message_id: savedMessage.telegram_message_id,
      });
      return true;
    }

    const currency = extracted.items[0].currency || 'ETB';
    const subtotal = extracted.items.reduce((s, it) => s + it.subtotal, 0);
    const total = Number(subtotal.toFixed(2));

    // Create the order (pending_payment) first so we have an ID for tx_ref
    const order = await createOrder({
      business_id: business.id,
      customer_id: customer.id,
      conversation_id: conversation.id,
      items: extracted.items,
      subtotal: total,
      total,
      currency,
      status: 'pending_payment',
      source: 'bot',
      customer_note: extracted.notes || null,
    });
    if (!order) return false;

    // Chapa link
    let link = null;
    try {
      link = await generateChapaLink({ business, customer, order, items: extracted.items, total, currency });
    } catch (e) {
      console.warn('Chapa link failed:', e.response?.data || e.message);
    }

    if (!link?.url) {
      // Mark cancelled and let the normal reply flow take over (so we don't promise a link we can't deliver)
      await updateOrder(order.id, { status: 'cancelled', owner_note: 'Chapa link generation failed' });
      const isAmharic = /[\u1200-\u137F]/.test(savedMessage.content);
      const out = isAmharic
        ? `ትእዛዝዎን ተቀብያለሁ። ${business.name} በቅርቡ ያገኙዎታል።`
        : `I've noted your order. ${business.name} will get back to you shortly to confirm.`;
      await bot.sendMessage(savedMessage.telegram_chat_id, out, {
        reply_to_message_id: savedMessage.telegram_message_id,
      });
      // Notify owner so they can follow up manually
      if (business.owner_private_chat_id) {
        await bot.sendMessage(business.owner_private_chat_id,
          `🛒 New order from ${customer?.name || 'customer'} — Chapa link failed, please follow up manually.\n\n` +
          extracted.items.map(it => `  • ${it.quantity} × ${it.name}`).join('\n') +
          `\n\nTotal: ${total} ${currency}`);
      }
      return true;
    }

    await updateOrder(order.id, { chapa_tx_ref: link.txRef, checkout_url: link.url });

    // Reply to customer in their language
    const isAmharic = /[\u1200-\u137F]/.test(savedMessage.content);
    const reply = isAmharic
      ? amharicOrderConfirmation(business, extracted.items, total, currency, link.url)
      : englishOrderConfirmation(business, extracted.items, total, currency, link.url);

    await bot.sendMessage(savedMessage.telegram_chat_id, reply, {
      reply_to_message_id: savedMessage.telegram_message_id,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });

    // Log our outbound
    await createMessage({
      conversation_id: conversation.id,
      business_id: business.id,
      customer_id: customer.id,
      direction: 'outbound',
      content: reply,
      content_type: 'text',
      status: 'sent',
      is_ai_generated: true,
      ai_model: 'checkout-flow',
      telegram_chat_id: savedMessage.telegram_chat_id,
      sent_at: new Date().toISOString(),
    });

    await notifyOwnerNewOrder(bot, business, customer, order, extracted.items, total, currency);

    return true;
  } catch (e) {
    console.error('tryCheckout error:', e);
    return false;
  }
}

module.exports = { tryCheckout };
