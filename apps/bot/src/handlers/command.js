const {
  findByOwnerTelegramId, update: updateBusiness,
  setPanicMode, setTrustLevel,
} = require('../../../../packages/db/queries/businesses');
const { findByBusiness: findProducts, create: createProduct, update: updateProduct } = require('../../../../packages/db/queries/products');
const { findByBusiness: findCustomers, getTopCustomers } = require('../../../../packages/db/queries/customers');
const { getTodayStats } = require('../../../../packages/db/queries/messages');
const { TRUST_LEVEL_NAMES, TRUST_LEVELS } = require('../../../../packages/shared/constants');
const { handleOnboardingStart } = require('./onboarding');

async function handleCommand(bot, msg) {
  try {
    const [cmd] = msg.text.split(' ');
    const args = msg.text.slice(cmd.length).trim();
    const senderId = msg.from.id;
    const chatId = msg.chat.id;

    if (cmd === '/start') {
      const business = await findByOwnerTelegramId(senderId);
      if (!business) {
        await handleOnboardingStart(bot, msg);
      } else {
        await updateBusiness(business.id, { owner_private_chat_id: chatId });
        if (!business.onboarding_completed) {
          await handleOnboardingStart(bot, msg);
        } else {
          const webUrl = process.env.WEB_URL;
        const opts = webUrl ? {
          reply_markup: {
            inline_keyboard: [[{ text: '📊 Open Dashboard', web_app: { url: webUrl } }]],
          },
        } : {};
        await bot.sendMessage(chatId, `🪞 Welcome back! MiniMe is active.\n\nTrust level: ${TRUST_LEVEL_NAMES[business.trust_level].emoji} ${TRUST_LEVEL_NAMES[business.trust_level].en}\nPanic mode: ${business.panic_mode ? '🔴 ON' : '🟢 OFF'}\n\nTap the button below to open your dashboard.`, opts);
        }
      }
      return;
    }

    // All other commands require a registered business
    const business = await findByOwnerTelegramId(senderId);
    if (!business) {
      await bot.sendMessage(chatId, '⚠️ Please run /start first to set up your business.');
      return;
    }

    switch (cmd) {
      case '/advisor': {
        if (!args) {
          await bot.sendMessage(chatId,
            '🧠 MiniMe Advisor — your live client triage copilot\n\n' +
            'I see every active conversation and remember what we\'ve discussed.\n\n' +
            'Try:\n' +
            '• /advisor who should I reply to first?\n' +
            '• /advisor what should I say to Alem?\n' +
            '• /advisor any VIPs waiting?\n' +
            '• /advisor which threads are stale?\n' +
            '• /advisor draft a follow-up for Bereket\n' +
            '• /advisor reset  (clear memory)'
          );
          break;
        }
        if (args.trim().toLowerCase() === 'reset') {
          const { resetAdvisorMemory } = require('../services/advisor');
          await resetAdvisorMemory(business);
          await bot.sendMessage(chatId, '🧠 Advisor memory cleared.');
          break;
        }
        const { askAdvisor } = require('../services/advisor');
        await bot.sendChatAction(chatId, 'typing');
        // Re-fetch business so we get latest advisor_memory
        const fresh = await findByOwnerTelegramId(senderId);
        const answer = await askAdvisor(fresh || business, args);
        await bot.sendMessage(chatId, `🧠 ${answer}`);
        break;
      }

      case '/link': {
        if (msg.chat.type === 'private') {
          await bot.sendMessage(chatId, '⚠️ Run /link inside a group chat where you receive customer messages. I\'ll link that group to your business.');
          break;
        }
        await updateBusiness(business.id, { business_group_chat_id: chatId });
        await bot.sendMessage(chatId, `✅ Linked! This group is now connected to "${business.name}".\n\nWhen customers message here, MiniMe will draft replies and notify you privately.`);
        break;
      }

      case '/unlink': {
        if (business.business_group_chat_id) {
          await updateBusiness(business.id, { business_group_chat_id: null });
          await bot.sendMessage(chatId, '✅ Group unlinked from your business.');
        } else {
          await bot.sendMessage(chatId, 'No group is currently linked.');
        }
        break;
      }

      case '/panic':
        await setPanicMode(business.id, true);
        await bot.sendMessage(chatId, '🔴 PANIC MODE ON\n\nMiniMe is paused. You have full manual control.\nCustomers will NOT get any AI replies.\n\nType /resume when ready.');
        break;

      case '/resume':
        await setPanicMode(business.id, false);
        const lvl = TRUST_LEVEL_NAMES[business.trust_level];
        await bot.sendMessage(chatId, `🟢 MiniMe resumed!\n\nTrust level: ${lvl.emoji} ${lvl.en}`);
        break;

      case '/trust': {
        const current = business.trust_level;
        const keyboard = Object.entries(TRUST_LEVEL_NAMES).map(([level, info]) => [{
          text: `${info.emoji} ${info.en}${parseInt(level) === current ? ' ✓' : ''}`,
          callback_data: `trust_set_${level}`,
        }]);
        await bot.sendMessage(chatId, `Current trust level: ${TRUST_LEVEL_NAMES[current].emoji} ${TRUST_LEVEL_NAMES[current].en}\n\nSelect new level:`, {
          reply_markup: { inline_keyboard: keyboard },
        });
        break;
      }

      case '/status': {
        const stats = await getTodayStats(business.id);
        const inbound = stats.filter(m => m.direction === 'inbound').length;
        const aiSent = stats.filter(m => m.is_ai_generated && m.status === 'sent').length;
        const edited = stats.filter(m => m.owner_edited).length;
        const drafted = stats.filter(m => m.status === 'drafted').length;
        const aiHandledPct = inbound > 0 ? Math.round((aiSent / inbound) * 100) : 0;
        const editRate = aiSent > 0 ? Math.round((edited / aiSent) * 100) : 0;
        await bot.sendMessage(chatId,
          `📊 Today's Stats\n\n` +
          `📩 Messages received: ${inbound}\n` +
          `🤖 AI handled: ${aiHandledPct}%\n` +
          `✏️ Edit rate: ${editRate}%\n` +
          `⏳ Pending approval: ${drafted}\n` +
          `\nTrust: ${TRUST_LEVEL_NAMES[business.trust_level].emoji} ${TRUST_LEVEL_NAMES[business.trust_level].en}\n` +
          `Panic: ${business.panic_mode ? '🔴 ON' : '🟢 OFF'}`
        );
        break;
      }

      case '/products': {
        const products = await findProducts(business.id);
        if (!products.length) {
          await bot.sendMessage(chatId, '📦 No products yet. Use /addproduct to add one.');
          break;
        }
        const list = products.map(p =>
          `• ${p.name} — ${p.price} ETB | Stock: ${p.stock_quantity}${p.stock_quantity <= p.low_stock_threshold ? ' ⚠️ LOW' : ''}`
        ).join('\n');
        await bot.sendMessage(chatId, `📦 Products:\n\n${list}`);
        break;
      }

      case '/addproduct': {
        const parts = args.split(',').map(s => s.trim());
        if (parts.length < 2) {
          await bot.sendMessage(chatId, 'Usage: /addproduct Name, Price, Stock\nExample: /addproduct NFC Card, 500, 100');
          break;
        }
        const [name, price, stock] = parts;
        const product = await createProduct({
          business_id: business.id,
          name,
          price: parseFloat(price) || 0,
          stock_quantity: parseInt(stock) || 0,
        });
        await bot.sendMessage(chatId, product
          ? `✅ Added: ${product.name} — ${product.price} ETB | Stock: ${product.stock_quantity}`
          : '❌ Failed to add product. Try again.'
        );
        break;
      }

      case '/price': {
        const parts = args.split(' ');
        if (parts.length < 2) {
          await bot.sendMessage(chatId, 'Usage: /price ProductName NewPrice\nExample: /price "NFC Card" 600');
          break;
        }
        const newPrice = parseFloat(parts[parts.length - 1]);
        const productName = parts.slice(0, -1).join(' ').replace(/"/g, '');
        const products = await findProducts(business.id);
        const product = products.find(p => p.name.toLowerCase().includes(productName.toLowerCase()));
        if (!product) {
          await bot.sendMessage(chatId, `❌ Product "${productName}" not found.`);
          break;
        }
        await updateProduct(product.id, { price: newPrice });
        await bot.sendMessage(chatId, `✅ ${product.name} price updated to ${newPrice} ETB`);
        break;
      }

      case '/stock': {
        const products = await findProducts(business.id);
        const low = products.filter(p => p.stock_quantity <= p.low_stock_threshold);
        let msg = '📦 Inventory:\n\n';
        msg += products.map(p =>
          `${p.stock_quantity <= p.low_stock_threshold ? '⚠️' : '✅'} ${p.name}: ${p.stock_quantity} units`
        ).join('\n');
        if (low.length) msg += `\n\n⚠️ ${low.length} item(s) low on stock!`;
        await bot.sendMessage(chatId, msg);
        break;
      }

      case '/customers': {
        const top = await getTopCustomers(business.id, 5);
        if (!top.length) {
          await bot.sendMessage(chatId, '👥 No customers yet.');
          break;
        }
        const list = top.map((c, i) =>
          `${i + 1}. ${c.name || 'Unknown'} — ${c.total_spent} ETB | ${c.total_orders} orders | ${c.tier.toUpperCase()}`
        ).join('\n');
        await bot.sendMessage(chatId, `👥 Top Customers:\n\n${list}`);
        break;
      }

      case '/analytics': {
        const { getWeekly } = require('../../../../packages/db/queries/analytics');
        const weekly = await getWeekly(business.id);
        const totalMsgs = weekly.reduce((s, d) => s + d.total_messages, 0);
        const totalRevenue = weekly.reduce((s, d) => s + Number(d.revenue), 0);
        const avgConfidence = weekly.filter(d => d.avg_ai_confidence).reduce((s, d) => s + d.avg_ai_confidence, 0) / (weekly.filter(d => d.avg_ai_confidence).length || 1);
        await bot.sendMessage(chatId,
          `📈 This Week\n\n` +
          `💬 Messages: ${totalMsgs}\n` +
          `💰 Revenue: ${totalRevenue.toFixed(2)} ETB\n` +
          `🤖 Avg AI confidence: ${Math.round(avgConfidence * 100)}%`
        );
        break;
      }

      case '/upgrade': {
        const { generatePaymentLink } = require('../services/payment');
        const link = await generatePaymentLink(business);
        await bot.sendMessage(chatId, link
          ? `💳 Upgrade to MiniMe Pro (2,500 ETB/month)\n\n${link}`
          : '❌ Could not generate payment link. Contact support.'
        );
        break;
      }

      case '/voice':
        await bot.sendMessage(chatId, '🎙️ Let\'s update your voice profile!\n\nI\'ll ask you some questions about how you communicate with customers. Your answers train MiniMe to sound just like you.\n\nSend your first example greeting:');
        await updateBusiness(business.id, { onboarding_step: 2 });
        break;

      case '/remind': {
        if (!args) {
          await bot.sendMessage(chatId, '⏰ Usage: /remind <when> | <what>\nExamples:\n• /remind tomorrow 9am | call Alem about the invoice\n• /remind in 2 hours | restock NFC cards');
          break;
        }
        const { parseWhen, createReminder } = require('../services/scheduler');
        const [whenPart, ...rest] = args.split('|');
        const text = rest.join('|').trim();
        if (!text) {
          await bot.sendMessage(chatId, '⏰ Missing the reminder text. Use: /remind <when> | <what>');
          break;
        }
        const iso = await parseWhen(whenPart.trim());
        if (!iso) {
          await bot.sendMessage(chatId, `❌ I couldn't understand "${whenPart.trim()}" as a time. Try "tomorrow 9am" or "in 2 hours".`);
          break;
        }
        await createReminder({ businessId: business.id, whenIso: iso, text });
        await bot.sendMessage(chatId, `⏰ Got it. I'll remind you at ${new Date(iso).toUTCString()}:\n"${text}"`);
        break;
      }

      case '/schedule': {
        const { findByBusiness: findTasks } = require('../../../../packages/db/queries/tasks');
        const tasks = await findTasks(business.id, { status: 'scheduled', limit: 20 });
        if (!tasks.length) {
          await bot.sendMessage(chatId, '📅 Nothing scheduled. Use /remind to add one.');
          break;
        }
        const list = tasks
          .filter(t => t.scheduled_at)
          .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
          .map(t => `• ${new Date(t.scheduled_at).toUTCString().slice(0, 22)} — [${t.type}] ${t.description || ''}`)
          .join('\n');
        await bot.sendMessage(chatId, `📅 Upcoming:\n\n${list}`);
        break;
      }

      case '/suppliers': {
        const { findByBusiness: findSuppliers } = require('../../../../packages/db/queries/suppliers');
        const list = await findSuppliers(business.id);
        if (!list.length) {
          await bot.sendMessage(chatId,
            '🏭 No suppliers yet.\n\n' +
            'Add one with /addsupplier — works for both local and international vendors.'
          );
          break;
        }
        const lines = list.map(s => {
          const flag = s.is_international ? '🌍' : '🇪🇹';
          const channel = s.preferred_channel ? ` · ${s.preferred_channel}` : '';
          const lead = s.lead_time_days ? ` · ${s.lead_time_days}d lead` : (s.avg_delivery_days ? ` · ${s.avg_delivery_days}d` : '');
          const ccy = s.currency && s.currency !== 'ETB' ? ` (${s.currency})` : '';
          return `${flag} *${s.name}*${ccy}${channel}${lead}\n   ${s.country || 'Local'} · ${(s.products_supplied || []).join(', ') || '(no products tagged)'}`;
        }).join('\n\n');
        await bot.sendMessage(chatId, `🏭 Suppliers (${list.length}):\n\n${lines}`, { parse_mode: 'Markdown' });
        break;
      }

      case '/addsupplier': {
        if (!args) {
          await bot.sendMessage(chatId,
            '🏭 *Add a supplier* — works for local & international vendors.\n\n' +
            'Format: comma-separated `key=value` pairs.\n\n' +
            '*Required:* `name`\n' +
            '*Recommended:* `country`, `email` *or* `whatsapp` *or* `telegram_id`, `products`\n' +
            '*Optional:* `currency`, `lead_days`, `moq`, `payment_terms`, `incoterms`, `website`, `wechat`, `language`, `channel`, `phone`\n\n' +
            '*🌍 International example:*\n' +
            '`/addsupplier name=Shenzhen NFC Co, country=China, email=sales@sznfc.com, products=NFC Card;NFC Reader, currency=USD, lead_days=21, moq=500, payment_terms=30/70 T/T, incoterms=FOB, website=sznfc.com, channel=email, language=en`\n\n' +
            '*🇪🇹 Local example:*\n' +
            '`/addsupplier name=አበበ ንግድ, country=Ethiopia, phone=+251911223344, products=ስኳር;ዘይት, lead_days=2, channel=telegram`\n\n' +
            '`products=` and `name=` accept either commas inside `;`-separated lists.',
            { parse_mode: 'Markdown' }
          );
          break;
        }

        // Parse "key=value, key=value" — values may contain spaces and ; lists
        const fields = {};
        for (const raw of args.split(/,(?=\s*[a-zA-Z_]+\s*=)/)) {
          const [k, ...rest] = raw.split('=');
          if (!k || !rest.length) continue;
          fields[k.trim().toLowerCase()] = rest.join('=').trim();
        }

        if (!fields.name) {
          await bot.sendMessage(chatId, '❌ Missing required `name=`. Try /addsupplier with no args to see the format.', { parse_mode: 'Markdown' });
          break;
        }

        const country = fields.country || null;
        const isLocal = country && /ethio|^et$|ኢትዮጵያ/i.test(country);
        const isInternational = country ? !isLocal : false;

        // Pick a sensible preferred channel if not given
        let channel = (fields.channel || '').toLowerCase();
        if (!channel) {
          if (fields.telegram_id) channel = 'telegram';
          else if (fields.email) channel = 'email';
          else if (fields.whatsapp) channel = 'whatsapp';
          else if (fields.wechat) channel = 'wechat';
          else if (fields.phone) channel = 'phone';
          else channel = 'manual';
        }

        const products = fields.products
          ? fields.products.split(/[;|]/).map(s => s.trim()).filter(Boolean)
          : [];

        const supplierData = {
          business_id: business.id,
          name: fields.name,
          contact_name: fields.contact || fields.contact_name || null,
          contact_email: fields.email || null,
          contact_phone: fields.phone || null,
          contact_telegram: fields.telegram_id ? Number(fields.telegram_id) : null,
          whatsapp_number: fields.whatsapp || null,
          wechat_id: fields.wechat || null,
          website_url: fields.website ? (fields.website.startsWith('http') ? fields.website : `https://${fields.website}`) : null,
          country,
          country_code: fields.country_code || null,
          currency: (fields.currency || (isInternational ? 'USD' : 'ETB')).toUpperCase(),
          language: fields.language || (isInternational ? 'en' : 'am'),
          preferred_channel: channel,
          min_order_quantity: fields.moq ? parseInt(fields.moq, 10) : null,
          lead_time_days: fields.lead_days ? parseInt(fields.lead_days, 10) : null,
          avg_delivery_days: fields.lead_days ? parseInt(fields.lead_days, 10) : 3,
          payment_terms: fields.payment_terms || null,
          incoterms: fields.incoterms ? fields.incoterms.toUpperCase() : null,
          products_supplied: products,
          notes: fields.notes || null,
          is_international: isInternational,
          is_active: true,
        };

        const { create: createSupplier } = require('../../../../packages/db/queries/suppliers');
        const created = await createSupplier(supplierData);

        if (!created) {
          await bot.sendMessage(chatId, '❌ Could not save supplier. Check the format and try again.');
          break;
        }

        const flag = created.is_international ? '🌍' : '🇪🇹';
        const channelLine = {
          email: `📧 ${created.contact_email}`,
          whatsapp: `💬 WhatsApp ${created.whatsapp_number}`,
          wechat: `💬 WeChat ${created.wechat_id}`,
          telegram: `✈️ Telegram ${created.contact_telegram}`,
          phone: `📞 ${created.contact_phone}`,
          manual: '✋ Manual (you\'ll forward drafts)',
        }[created.preferred_channel] || created.preferred_channel;

        await bot.sendMessage(chatId,
          `✅ *${created.name}* added ${flag}\n\n` +
          `${channelLine}\n` +
          (created.country ? `📍 ${created.country}\n` : '') +
          (created.currency ? `💱 Currency: ${created.currency}\n` : '') +
          (created.lead_time_days ? `🚚 Lead time: ${created.lead_time_days} days\n` : '') +
          (created.min_order_quantity ? `📦 MOQ: ${created.min_order_quantity}\n` : '') +
          (created.payment_terms ? `💳 Terms: ${created.payment_terms}\n` : '') +
          (created.incoterms ? `📑 Incoterms: ${created.incoterms}\n` : '') +
          (products.length ? `🏷️ Products: ${products.join(', ')}\n` : '') +
          `\nWhen stock runs low, MiniMe will draft a reorder${created.is_international ? ' in English (formal trade tone)' : ' in Amharic'} and ${
            created.preferred_channel === 'telegram' ? 'send via Telegram' :
            created.preferred_channel === 'email' ? (process.env.RESEND_API_KEY ? 'send via email' : 'give you a tappable mailto: link') :
            created.preferred_channel === 'whatsapp' ? 'give you a wa.me link to tap' :
            'send the draft to you to forward'
          }.`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case '/editsupplier': {
        if (!args) {
          await bot.sendMessage(chatId,
            '✏️ *Edit a supplier*\n\n' +
            'Format: `/editsupplier <supplier name> | field=value, field=value`\n\n' +
            'Example:\n`/editsupplier Shenzhen NFC Co | lead_days=14, payment_terms=40/60, channel=email`\n\n' +
            'Editable fields: name, email, phone, whatsapp, wechat, telegram_id, website, country, currency, language, channel, moq, lead_days, payment_terms, incoterms, products, notes',
            { parse_mode: 'Markdown' }
          );
          break;
        }
        const [namePart, ...rest] = args.split('|');
        const searchName = namePart.trim();
        const fieldsStr = rest.join('|').trim();
        if (!searchName || !fieldsStr) {
          await bot.sendMessage(chatId, '❌ Format: `/editsupplier <name> | field=value, ...`', { parse_mode: 'Markdown' });
          break;
        }

        const { findByBusiness: findSuppliers, update: updateSupplier } = require('../../../../packages/db/queries/suppliers');
        const all = await findSuppliers(business.id);
        const supplier = all.find(s => s.name.toLowerCase().includes(searchName.toLowerCase()));
        if (!supplier) {
          await bot.sendMessage(chatId, `❌ No supplier matching "${searchName}". Run /suppliers to see the list.`);
          break;
        }

        const fields = {};
        for (const raw of fieldsStr.split(/,(?=\s*[a-zA-Z_]+\s*=)/)) {
          const [k, ...v] = raw.split('=');
          if (k && v.length) fields[k.trim().toLowerCase()] = v.join('=').trim();
        }

        const updates = {};
        if (fields.name) updates.name = fields.name;
        if (fields.email) updates.contact_email = fields.email;
        if (fields.phone) updates.contact_phone = fields.phone;
        if (fields.whatsapp) updates.whatsapp_number = fields.whatsapp;
        if (fields.wechat) updates.wechat_id = fields.wechat;
        if (fields.telegram_id) updates.contact_telegram = Number(fields.telegram_id);
        if (fields.website) updates.website_url = fields.website.startsWith('http') ? fields.website : `https://${fields.website}`;
        if (fields.country) {
          updates.country = fields.country;
          updates.is_international = !/ethio|^et$|ኢትዮጵያ/i.test(fields.country);
        }
        if (fields.currency) updates.currency = fields.currency.toUpperCase();
        if (fields.language) updates.language = fields.language;
        if (fields.channel) updates.preferred_channel = fields.channel.toLowerCase();
        if (fields.moq) updates.min_order_quantity = parseInt(fields.moq, 10);
        if (fields.lead_days) { updates.lead_time_days = parseInt(fields.lead_days, 10); updates.avg_delivery_days = updates.lead_time_days; }
        if (fields.payment_terms) updates.payment_terms = fields.payment_terms;
        if (fields.incoterms) updates.incoterms = fields.incoterms.toUpperCase();
        if (fields.products) updates.products_supplied = fields.products.split(/[;|]/).map(s => s.trim()).filter(Boolean);
        if (fields.notes) updates.notes = fields.notes;
        if (fields.contact) updates.contact_name = fields.contact;

        if (!Object.keys(updates).length) {
          await bot.sendMessage(chatId, '❌ No recognized fields to update.');
          break;
        }

        const saved = await updateSupplier(supplier.id, updates);
        if (!saved) { await bot.sendMessage(chatId, '❌ Update failed.'); break; }

        const changed = Object.keys(updates).map(k => `• ${k}: ${JSON.stringify(updates[k])}`).join('\n');
        await bot.sendMessage(chatId, `✅ Updated *${saved.name}*:\n${changed}`, { parse_mode: 'Markdown' });
        break;
      }

      case '/deletesupplier': {
        if (!args) {
          await bot.sendMessage(chatId, 'Usage: `/deletesupplier <name>` — soft-deletes (sets is_active=false).', { parse_mode: 'Markdown' });
          break;
        }
        const { findByBusiness: findSuppliers, update: updateSupplier } = require('../../../../packages/db/queries/suppliers');
        const all = await findSuppliers(business.id);
        const supplier = all.find(s => s.name.toLowerCase().includes(args.toLowerCase()));
        if (!supplier) { await bot.sendMessage(chatId, `❌ No supplier matching "${args}".`); break; }
        await updateSupplier(supplier.id, { is_active: false });
        await bot.sendMessage(chatId, `🗑️ Archived supplier *${supplier.name}* (soft-deleted — re-activate by re-adding).`, { parse_mode: 'Markdown' });
        break;
      }

      case '/docs': {
        const { listDocuments } = require('../../../../packages/db/queries/documents');
        const docs = await listDocuments(business.id);
        if (!docs.length) {
          await bot.sendMessage(chatId, '📚 No documents uploaded yet. Open the Dashboard → Documents to upload a PDF (price list, menu, brochure).');
          break;
        }
        const list = docs.map(d => {
          const badge = d.status === 'ready' ? '✅' : d.status === 'failed' ? '❌' : '⏳';
          return `${badge} ${d.title}${d.tag ? ` [${d.tag}]` : ''} — ${d.status}`;
        }).join('\n');
        await bot.sendMessage(chatId, `📚 Knowledge Base (${docs.length}):\n\n${list}\n\nUpload more via the Dashboard.`);
        break;
      }

      case '/briefing': {
        const { sendMorningBriefing } = require('../services/scheduler');
        await sendMorningBriefing(bot, business);
        break;
      }

      case '/help':
        await bot.sendMessage(chatId,
          `🪞 MiniMe Commands\n\n` +
          `🧠 /advisor <question> — Live client triage copilot (remembers context)\n` +
          `⏰ /remind <when> | <what> — Set a reminder\n` +
          `📅 /schedule — See upcoming reminders/follow-ups\n` +
          `📚 /docs — List uploaded knowledge-base documents\n` +
          `☀️ /briefing — Get the morning briefing now\n` +
          `📊 /status — Today's stats\n` +
          `🎚 /trust — Change AI trust level\n` +
          `🔴 /panic — Pause MiniMe (manual mode)\n` +
          `🟢 /resume — Resume MiniMe\n` +
          `📦 /products — List products\n` +
          `➕ /addproduct — Add a product\n` +
          `💰 /price — Update product price\n` +
          `📥 /stock — Check inventory\n` +
          `🏭 /suppliers — List suppliers\n` +
          `➕ /addsupplier — Add a local or international supplier\n` +
          `✏️ /editsupplier — Update supplier fields\n` +
          `🗑️ /deletesupplier — Archive a supplier\n` +
          `👥 /customers — Top customers\n` +
          `📈 /analytics — Weekly stats\n` +
          `🎙 /voice — Update voice profile\n` +
          `🔗 /link — Link a group chat to your business\n` +
          `💳 /upgrade — Upgrade subscription\n` +
          `ℹ️ /help — This message\n\n` +
          `Open 📊 Dashboard anytime from the menu button below.`
        );
        break;

      default:
        await bot.sendMessage(chatId, 'Unknown command. Type /help for a list of commands.');
    }

  } catch (error) {
    console.error('Command handler error:', error);
    try { await bot.sendMessage(msg.chat.id, '❌ Something went wrong. Try again.'); } catch (_) {}
  }
}

module.exports = { handleCommand };
