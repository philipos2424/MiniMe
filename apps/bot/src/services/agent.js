const { create: createTask, findById: findTask, updateTask, addStep, addDecisionLog } = require('../../../../packages/db/queries/tasks');
const { findByBusiness: findProducts, updateStock } = require('../../../../packages/db/queries/products');
const { getBestForProduct } = require('../../../../packages/db/queries/suppliers');
const { findAll: findAllBusinesses } = require('../../../../packages/db/queries/businesses');
const { makeAgentDecision } = require('./ai');
const { agentDecisionPrompt } = require('../../../../packages/shared/prompts');
const { notifyOwnerTask } = require('./notification');

// In-memory lock for tasks currently being executed to prevent race conditions.
// In a cluster/multi-server setup, use Redis for this.
const executingTasks = new Set();

async function runAgentChecks(bot) {
  try {
    const businesses = await findAllBusinesses();
    for (const business of businesses) {
      if (business.panic_mode || business.trust_level < 2) continue;
      await checkInventory(bot, business);
      await checkPaymentFollowups(bot, business);
      await checkCustomerFollowups(bot, business);
    }
  } catch (e) {
    console.error('runAgentChecks error:', e.message);
  }
}

async function checkInventory(bot, business) {
  try {
    const products = await findProducts(business.id);
    for (const product of products) {
      if (product.stock_quantity <= product.low_stock_threshold) {
        const existing = await require('../../../../packages/db/queries/tasks').findByBusiness(business.id, { status: 'pending' });
        const alreadyPending = existing.some(t => t.type === 'supply_reorder' && t.product_id === product.id);
        if (alreadyPending) continue;

        const suppliers = await getBestForProduct(business.id, product.name);
        const context = { product, suppliers, current_stock: product.stock_quantity, threshold: product.low_stock_threshold };
        const prompt = agentDecisionPrompt(business, 'supply_reorder', context);
        const decision = await makeAgentDecision(prompt);

        const task = await createTask({
          business_id: business.id,
          type: 'supply_reorder',
          title: `Reorder ${product.name}`,
          description: `Stock at ${product.stock_quantity} (threshold: ${product.low_stock_threshold}). ${decision.decision}`,
          status: 'awaiting_approval',
          urgency: product.stock_quantity === 0 ? 'critical' : 'high',
          product_id: product.id,
          supplier_name: suppliers[0]?.name,
          estimated_amount: suppliers[0] ? Math.round(product.cost_price * 50 * 100) / 100 : null,
          payload: context,
          decision_log: [{ decision: decision.decision, reasoning: decision.reasoning, confidence: decision.confidence, timestamp: new Date().toISOString() }],
          requires_approval: true,
        });


        await notifyOwnerTask(bot, business, task);
      }
    }
  } catch (e) {
    console.error('checkInventory error:', e.message);
  }
}

async function checkPaymentFollowups(bot, business) {
  try {
    const { getPendingFollowups } = require('../../../../packages/db/queries/payments');
    const pending = await getPendingFollowups(business.id);
    const threeDaysAgo = Date.now() - 3 * 86400000;

    for (const payment of pending) {
      if (new Date(payment.created_at).getTime() > threeDaysAgo) continue;
      if (payment.reminder_count >= 3) continue;

        const task = await createTask({
          business_id: business.id,
          type: 'payment_followup',
          title: `Payment follow-up: ${payment.customers?.name || 'Customer'}`,
          description: `${payment.amount} ETB pending for ${Math.floor((Date.now() - new Date(payment.created_at)) / 86400000)} days`,
          status: 'awaiting_approval',
          urgency: 'medium',
          customer_id: payment.customer_id,
          estimated_amount: Math.round(payment.amount * 100) / 100,
          requires_approval: true,
        });


      await notifyOwnerTask(bot, business, task);
    }
  } catch (e) {
    console.error('checkPaymentFollowups error:', e.message);
  }
}

/**
 * Scan active conversations and create follow-up tasks:
 *  - Silent quote/inquiry 48h → notify owner (or schedule a draft)
 *  - Cold lead 14 days → suggest a warm check-in
 * Deduplicates via existing scheduled tasks per customer.
 */
async function checkCustomerFollowups(bot, business) {
  try {
    const { findByBusiness: findConversations } = require('../../../../packages/db/queries/conversations');
    const { findByBusiness: findTasks } = require('../../../../packages/db/queries/tasks');
    const conversations = await findConversations(business.id, { limit: 50 });
    if (!conversations?.length) return;

    const existing = await findTasks(business.id, { status: 'scheduled', limit: 100 });
    const alreadyQueued = new Set(
      existing.filter(t => t.type === 'followup' && t.customer_id).map(t => t.customer_id)
    );

    const now = Date.now();
    const HOURS_48 = 48 * 3600 * 1000;
    const DAYS_14 = 14 * 86400 * 1000;

    for (const c of conversations) {
      if (c.status !== 'active') continue;
      if (!c.last_message_at) continue;
      const last = new Date(c.last_message_at).getTime();
      const age = now - last;
      const customerId = c.customer_id;
      if (!customerId || alreadyQueued.has(customerId)) continue;

      const lastAction = c.last_ai_action;
      const isSilentQuote = age >= HOURS_48 && age < DAYS_14 &&
        ['auto_sent', 'drafted', 'escalated'].includes(lastAction);
      const isCold = age >= DAYS_14;

      if (!isSilentQuote && !isCold) continue;

      const reason = isCold
        ? `Cold lead — no activity for ${Math.floor(age / 86400000)} days`
        : `Silent quote — no reply in ${Math.round(age / 3600000)} hours`;

      // Schedule the follow-up for the next 9 AM EAT (06:00 UTC)
      const next = new Date();
      next.setUTCHours(6, 0, 0, 0);
      if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);

      await createTask({
        business_id: business.id,
        type: 'followup',
        status: 'scheduled',
        scheduled_at: next.toISOString(),
        customer_id: customerId,
        title: `Follow-up: ${c.customers?.name || 'customer'}`,
        description: reason,
        context: { reason, conversation_id: c.id, last_action: lastAction },
      });
      alreadyQueued.add(customerId);
    }
  } catch (e) {
    console.error('checkCustomerFollowups error:', e.message);
  }
}

/**
 * Actually execute a task. Sends real Telegram messages and logs every step.
 */
async function executeTask(bot, taskId) {
  const { findById: findBusinessById } = require('../../../../packages/db/queries/businesses');
  const { findById: findSupplier } = require('../../../../packages/db/queries/suppliers');
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (executingTasks.has(taskId)) {
    console.info(`Task ${taskId} is already being executed. Skipping.`);
    return;
  }
  executingTasks.add(taskId);

  try {
    const task = await findTask(taskId);
    if (!task) {
      executingTasks.delete(taskId);
      return;
    }
    const business = await findBusinessById(task.business_id);
    if (!business) {
      executingTasks.delete(taskId);
      throw new Error('Business not found');
    }

    await updateTask(taskId, { status: 'in_progress' });
    await addStep(taskId, { step: 'Started execution', status: 'completed' });

    // ------------------------------------------------------------------
    // SUPPLY REORDER → contact the supplier (or DM the owner the draft)
    // ------------------------------------------------------------------
    if (task.type === 'supply_reorder') {
      const product = task.payload?.product;
      const { findByBusiness: findSuppliers } = require('../../../../packages/db/queries/suppliers');
      const suppliers = await findSuppliers(business.id);
      const supplier = task.supplier_name
        ? suppliers.find(s => s.name === task.supplier_name)
        : null;

      const isIntl = !!supplier?.is_international;
      const lang = supplier?.language || (isIntl ? 'en' : 'am');
      const moq = supplier?.min_order_quantity || 50;
      const channel = supplier?.preferred_channel || 'manual';

      await addStep(taskId, { step: `Drafting ${isIntl ? 'international' : 'local'} supplier message`, status: 'in_progress' });

      // ---- Build a context-aware prompt. International = formal English trade tone; local = warm Amharic. ----
      const intlPrompt = `You are ${business.owner_name || business.name}, the owner of "${business.name}" — a business in Ethiopia sourcing products from an international supplier. Write a short, professional B2B email/message to reorder stock.

Supplier: ${supplier?.name || '(unknown)'} in ${supplier?.country || 'abroad'}
Contact person: ${supplier?.contact_name || 'Sales team'}
Product: ${product?.name || 'item'}
Our current stock: ${product?.stock_quantity ?? '?'} units (low)
Intended order quantity: ${moq} units${supplier?.min_order_quantity ? ' (MOQ)' : ''}
Currency: ${supplier?.currency || 'USD'}
Known payment terms: ${supplier?.payment_terms || 'to be discussed'}
Known Incoterms: ${supplier?.incoterms || 'to be confirmed'}

Write in professional but warm English. The message should:
1. Open with a proper greeting (use their contact name if known; otherwise "Dear Sales Team" or "Hello").
2. Briefly reference previous business if relevant (be natural — "We would like to place a new order").
3. State clearly: the product name, quantity (${moq}), and that you'd like to proceed.
4. Ask for: (a) current unit price in ${supplier?.currency || 'USD'}, (b) lead time to shipment, (c) confirmation of payment terms${supplier?.payment_terms ? ` (${supplier.payment_terms})` : ''}, (d) Incoterms${supplier?.incoterms ? ` (confirm ${supplier.incoterms})` : ''}.
5. Mention target delivery to Addis Ababa, Ethiopia if shipping is relevant.
6. Close professionally — "Best regards, ${business.owner_name || business.name}".

${channel === 'email'
  ? `Format as a proper email — include a one-line "Subject:" prefix at the very top (example subject: "Reorder — ${product?.name || 'Product'} · ${moq} units"), then a blank line, then the body.`
  : 'Format as a Telegram/WhatsApp message — no subject line, just the body, 4–6 short lines.'}

Output ONLY the message text. No backticks, no labels like "Email:".`;

      const localPrompt = `You are ${business.owner_name || business.name}, an Ethiopian business owner messaging a local supplier on Telegram. Write like a real human — warm, direct, Amharic-first (Ge'ez script ፊደል, NEVER transliteration).

Context:
- Product to restock: ${product?.name || 'item'}${product?.name_am ? ` (${product.name_am})` : ''}
- Current stock: ${product?.stock_quantity ?? '?'} (threshold: ${product?.low_stock_threshold ?? '?'})
- Want to order: ${moq} units

Write 2–3 short lines:
1. Warm, varied greeting ("ሰላም", "ሰላምታ ለእርስዎ", "እንደምን ነዎት")
2. Naturally mention needing to restock the product
3. Ask for: latest price + earliest delivery
4. Close with "አመሰግናለሁ" / "ተባረክ"

Sound like a real person texting. No emojis unless one fits at the end.

Output ONLY the message text.`;

      const draft = (await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.7,
        max_tokens: 400,
        messages: [{ role: 'user', content: isIntl ? intlPrompt : localPrompt }],
      })).choices[0].message.content.trim();

      // For email drafts, split the "Subject:" line from the body
      let subject = null;
      let body = draft;
      if (isIntl && channel === 'email') {
        const m = draft.match(/^\s*Subject:\s*(.+?)\s*\n([\s\S]+)$/i);
        if (m) { subject = m[1].trim(); body = m[2].trim(); }
        else { subject = `Reorder — ${product?.name || 'Product'} · ${moq} units`; }
      }

      await addDecisionLog(taskId, { action: 'draft_ready', draft, isIntl, channel, subject });

      const ownerChat = business.owner_private_chat_id;
      let dispatched = false;

      // -------- CHANNEL DISPATCH --------
      if (channel === 'telegram' && supplier?.contact_telegram) {
        await bot.sendMessage(supplier.contact_telegram, body);
        await addStep(taskId, { step: `Sent via Telegram to ${supplier.name}`, status: 'completed' });
        if (ownerChat) await bot.sendMessage(ownerChat, `🤖 Sent reorder to *${supplier.name}* via Telegram:\n\n${body}`, { parse_mode: 'Markdown' });
        dispatched = true;
      }
      else if (channel === 'email' && supplier?.contact_email) {
        const { sendEmail, buildMailtoLink } = require('./email');
        const result = await sendEmail({
          to: supplier.contact_email,
          subject: subject || `Reorder — ${product?.name || 'Product'}`,
          text: body,
          replyTo: business.email || undefined,
          fromName: business.name,
        });
        if (result.sent) {
          await addStep(taskId, { step: `Sent via email to ${supplier.contact_email}`, status: 'completed' });
          if (ownerChat) {
            await bot.sendMessage(ownerChat,
              `📧 Sent reorder email to *${supplier.name}* (${supplier.contact_email}):\n\n*Subject:* ${subject}\n\n${body}`,
              { parse_mode: 'Markdown' }
            );
          }
          dispatched = true;
        } else if (ownerChat) {
          // Email provider not configured → give the owner a tappable mailto link
          const mailto = buildMailtoLink({ to: supplier.contact_email, subject, body });
          await bot.sendMessage(ownerChat,
            `📧 Draft email for *${supplier.name}* — tap to open in your mail app:\n\n*To:* ${supplier.contact_email}\n*Subject:* ${subject}\n\n${body}\n\n${mailto}`,
            { parse_mode: 'Markdown', disable_web_page_preview: true }
          );
          await addStep(taskId, { step: 'Mailto link sent to owner (no email provider configured)', status: 'completed' });
          dispatched = true;
        }
      }
      else if (channel === 'whatsapp' && supplier?.whatsapp_number && ownerChat) {
        // Owner taps the wa.me link — WhatsApp has no server-to-server send for personal accounts
        const waNum = supplier.whatsapp_number.replace(/[^\d]/g, '');
        const waLink = `https://wa.me/${waNum}?text=${encodeURIComponent(body)}`;
        await bot.sendMessage(ownerChat,
          `💬 WhatsApp draft for *${supplier.name}* — tap to open in WhatsApp:\n\n${body}\n\n${waLink}`,
          { parse_mode: 'Markdown', disable_web_page_preview: true }
        );
        await addStep(taskId, { step: 'WhatsApp link sent to owner', status: 'completed' });
        dispatched = true;
      }

      // Fallback: no channel resolved → hand the draft to the owner
      if (!dispatched && ownerChat) {
        const contactHint = [
          supplier?.contact_email && `📧 ${supplier.contact_email}`,
          supplier?.whatsapp_number && `💬 ${supplier.whatsapp_number}`,
          supplier?.contact_phone && `📞 ${supplier.contact_phone}`,
          supplier?.website_url && `🌐 ${supplier.website_url}`,
        ].filter(Boolean).join('\n');
        await bot.sendMessage(ownerChat,
          `🤖 Draft for *${task.supplier_name || supplier?.name || '(unknown supplier)'}* — copy & send:\n\n${subject ? `*Subject:* ${subject}\n\n` : ''}${body}${contactHint ? `\n\n${contactHint}` : ''}`,
          { parse_mode: 'Markdown' }
        );
        await addStep(taskId, { step: 'Draft handed to owner (no dispatchable channel)', status: 'completed' });
      }

      await updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
      return;
    }

    // ------------------------------------------------------------------
    // PAYMENT FOLLOW-UP → message the customer in owner voice
    // ------------------------------------------------------------------
    if (task.type === 'payment_followup') {
      const { findById: findCustomer } = require('../../../../packages/db/queries/customers');
      const customer = task.customer_id ? await findCustomer(task.customer_id) : null;
      if (!customer) { await updateTask(taskId, { status: 'failed', error: 'No customer' }); return; }

      const voice = business.voice_embedding || {};
      const lang = voice.language?.primary || customer.language_preference || 'am';
      const prompt = `You are ${business.owner_name || business.name}, an Ethiopian business owner gently reminding a customer about an unpaid amount over Telegram. Sound like a real human — warm, polite, NEVER pushy or accusatory. Ethiopian culture: relationship comes before money.

Customer: ${customer.name || '(no name)'}
Amount outstanding: ${task.estimated_amount || 'the unpaid amount'} ETB
Customer's language: ${lang} (am=Amharic in Ge'ez ፊደል, en=English, mixed=both)

Write 1–2 short sentences that:
1. Open warmly — vary it ("ሰላም", "እንደምን ነዎት", a small "ይቅርታ ላስቸግርዎ" works for older customers)
2. Mention the amount once, softly ("ለ___ ብር ክፍያ" / "regarding the ___ birr"). Frame it as a friendly reminder, not a demand.
3. Close with a thank-you and openness ("አመሰግናለሁ" / "thank you, no rush — when you can")

NEVER:
- Use words like "owe", "debt", "overdue", "ዕዳ" — too harsh
- Use threats, deadlines, or all caps
- Start with "ATTENTION" or "REMINDER"
- Use more than one emoji (🙏 is OK if it fits)

Always Ge'ez script for Amharic — never "selam".

Output ONLY the message text — no quotes, no labels.`;
      let draft = (await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.75,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })).choices[0].message.content.trim();

      // Auto-attach a Chapa checkout link if we have an amount + secret key
      try {
        const { generateCustomerPaymentLink } = require('./payment');
        const url = await generateCustomerPaymentLink(
          business,
          customer,
          task.estimated_amount,
          `Payment reminder from ${business.name}`
        );
        if (url) {
          draft = `${draft}\n\n💳 Tap to pay securely: ${url}`;
          await addDecisionLog(taskId, { action: 'payment_link_attached', url });
        }
      } catch (e) {
        console.warn('payment_followup link attach failed:', e.message);
      }

      await addDecisionLog(taskId, { action: 'draft_ready', draft });

      // Trust gate
      const canAutoSend = business.trust_level >= 3 && !business.panic_mode;
      if (canAutoSend && customer.telegram_id) {
        await bot.sendMessage(customer.telegram_id, draft);
        await addStep(taskId, { step: `Auto-sent payment reminder to ${customer.name}`, status: 'completed' });
        if (business.owner_private_chat_id) {
          await bot.sendMessage(business.owner_private_chat_id, `💸 Sent to ${customer.name || 'customer'}:\n\n${draft}`);
        }
      } else if (business.owner_private_chat_id) {
        await bot.sendMessage(
          business.owner_private_chat_id,
          `💸 Draft payment reminder for *${customer.name || 'customer'}* — say YES to send:\n\n${draft}`,
          { parse_mode: 'Markdown' }
        );
        await addStep(taskId, { step: 'Draft queued for owner approval', status: 'completed' });
      }
      await updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
      return;
    }

    // ------------------------------------------------------------------
    // CUSTOMER FOLLOW-UP / COLD LEAD → warm check-in
    // ------------------------------------------------------------------
    if (task.type === 'followup' || task.type === 'customer_followup') {
      const { findById: findCustomer } = require('../../../../packages/db/queries/customers');
      const customer = task.customer_id ? await findCustomer(task.customer_id) : null;
      if (!customer) { await updateTask(taskId, { status: 'failed', error: 'No customer' }); return; }

      const reason = task.context?.reason || task.description || 'checking in';
      const voice = business.voice_embedding || {};
      const lang = voice.language?.primary || customer.language_preference || 'am';
      const prompt = `You are ${business.owner_name || business.name}, an Ethiopian business owner sending a warm, personal check-in to a customer over Telegram. You are NOT a marketer — you are a real person who remembers them.

Customer: ${customer.name || '(no name)'}
Tier: ${customer.tier || 'new'}${customer.total_orders ? ` · ${customer.total_orders} past orders` : ''}${customer.total_spent ? ` · ${customer.total_spent} ETB lifetime` : ''}
Why you're reaching out: ${reason}
Language: ${lang} (am=Amharic in Ge'ez ፊደል, en=English, mixed=both)

Write 1–2 short sentences that:
1. Open warmly and personally — vary it. For ${customer.tier === 'vip' ? 'a VIP, acknowledge them slightly ("እንደተለመደው") — they\'re loyal' : 'a regular customer, just a kind hello'}.
2. Ask an open, friendly question — "how are things?", "ነገሮች እንዴት ናቸው?", "ምን ይፈልጋሉ ዛሬ?" — NOT a sales pitch.
3. Optional: hint you're available if they need anything.

NEVER:
- Push a product
- Say "we miss you" / "ናፈቀን" — sounds desperate
- Use ALL CAPS or sales language ("Special offer!", "Don't miss!")
- Use more than one emoji

Always Ge'ez script for Amharic — never "selam" or "endemen".

Output ONLY the message text — no quotes, no labels.`;
      const draft = (await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.8,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })).choices[0].message.content.trim();

      await addDecisionLog(taskId, { action: 'draft_ready', draft });

      const canAutoSend = business.trust_level >= 3 && !business.panic_mode;
      if (canAutoSend && customer.telegram_id) {
        await bot.sendMessage(customer.telegram_id, draft);
        await addStep(taskId, { step: `Auto-sent follow-up to ${customer.name}`, status: 'completed' });
        if (business.owner_private_chat_id) {
          await bot.sendMessage(business.owner_private_chat_id, `🔔 Sent follow-up to ${customer.name || 'customer'}:\n\n${draft}`);
        }
      } else if (business.owner_private_chat_id) {
        await bot.sendMessage(
          business.owner_private_chat_id,
          `🔔 Draft follow-up for *${customer.name || 'customer'}* (${reason}):\n\n${draft}`,
          { parse_mode: 'Markdown' }
        );
      }
      await updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
      return;
    }

    // Default: mark complete
    await updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
  } catch (e) {
    console.error('executeTask error:', e);
    await updateTask(taskId, { status: 'failed', error: e.message });
  } finally {
    executingTasks.delete(taskId);
  }
}

module.exports = { runAgentChecks, executeTask, checkCustomerFollowups };
