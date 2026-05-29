/**
 * POST /api/agent-bot/webhook
 *
 * Webhook for the main MiniMe bot (TELEGRAM_BOT_TOKEN = @MiniMeAgentBot).
 *
 * Handles three update types:
 *   1. business_connection  — owner connects/disconnects personal Telegram account
 *   2. business_message     — customer messages owner's personal account (Business API)
 *   3. message              — owner directly messages @MiniMeAgentBot (commands, teach, etc.)
 *
 * Setup: GET /api/agent-bot/setup  Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabase } from '../../../../lib/server/db';
import { handleTenantUpdate } from '../../../../lib/server/replyEngine';
import { setBizConnId } from '../../../../lib/server/telegramApi';
import { findByBizConnId, findByOwnerTelegramId, findByShopCode, findLastBusinessForCustomer } from '../../../../lib/server/businesses';
import { encrypt, randomSecret } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AGENT_TOKEN    = (process.env.TELEGRAM_BOT_TOKEN     || '').trim();
const WEBHOOK_SECRET = (process.env.AGENT_BOT_WEBHOOK_SECRET || '').trim();
const MINIAPP_BASE   = (process.env.NEXT_PUBLIC_APP_URL     || 'https://web-theta-one-68.vercel.app').trim();
const WEB_URL        = (process.env.WEB_URL || MINIAPP_BASE).replace(/\/$/, '');

// ── In-memory signup sessions (short-lived — signup takes <2 min) ──────────
const signupSessions = new Map(); // userId → { step, data: { name?, category? } }

function shopCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const CATEGORIES = [
  ['📱 Electronics', 'electronics_phones'],
  ['👗 Fashion',     'clothing_fashion'],
  ['🍽 Food',        'food_beverage'],
  ['💆 Beauty',      'beauty_wellness'],
  ['🏠 Furniture',   'construction_interior'],
  ['🛠 Services',    'training_consulting'],
  ['📸 Photography', 'photography_video'],
  ['🚚 Delivery',    'transport_delivery'],
  ['🏪 Other',       'other'],
];

async function tg(method, body) {
  if (!AGENT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${AGENT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j?.ok) console.warn(`[agent-bot] tg ${method}:`, j?.description);
    return j;
  } catch (e) {
    console.warn(`[agent-bot] tg ${method} error:`, e.message);
    return null;
  }
}

export async function POST(request) {
  try {
    // ── Verify webhook secret ──────────────────────────────────────────────
    if (WEBHOOK_SECRET) {
      const headerSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
      const a = Buffer.from(headerSecret.trim());
      const b = Buffer.from(WEBHOOK_SECRET);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn('[agent-bot] secret mismatch — header:', headerSecret.length, 'expected:', WEBHOOK_SECRET.length);
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }

    if (!AGENT_TOKEN) {
      console.warn('[agent-bot] TELEGRAM_BOT_TOKEN not set');
      return NextResponse.json({ ok: true, skipped: 'no_token' });
    }

    const update = await request.json();
    console.log('[agent-bot] update type:', Object.keys(update).filter(k => k !== 'update_id').join(','));

    // ── 1. Business connection — owner connects personal account ──────────
    if (update.business_connection) {
      const conn = update.business_connection;
      console.log(`[agent-bot] business_connection: user=${conn.user?.id} enabled=${conn.is_enabled}`);

      const ownerId = conn.user?.id;
      if (ownerId) {
        const business = await findByOwnerTelegramId(String(ownerId));
        if (business) {
          await supabase()
            .from('businesses')
            .update({ telegram_biz_conn_id: conn.is_enabled ? conn.id : null })
            .eq('id', business.id);
          console.log('[agent-bot] stored conn_id for business:', business.id);
        } else {
          console.warn('[agent-bot] business_connection: no business for owner_telegram_id:', ownerId);
        }
      }

      if (conn.is_enabled) {
        await tg('sendMessage', {
          chat_id: conn.user_chat_id,
          parse_mode: 'Markdown',
          text: `✅ *MiniMe is now connected to your account!*\n\nI'll handle customer messages automatically — in your voice, 24/7.\n\n• Customers who message you on Telegram get instant AI replies\n• You can reply manually anytime — I'll learn from it\n• Send me any command here to manage your business\n\nReady to go. 🚀`,
        });
      } else {
        await tg('sendMessage', {
          chat_id: conn.user_chat_id,
          text: "👋 MiniMe disconnected from your personal account. Reconnect anytime: Telegram Settings → Business → Chatbots.",
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ── 2. Business message — customer messaged owner's personal account ──
    if (update.business_message || update.edited_business_message) {
      const bm = update.business_message || update.edited_business_message;
      const connId = bm.business_connection_id;
      const chatId = bm.chat?.id;

      console.log(`[agent-bot] business_message: conn=${connId} chat=${chatId} text="${bm.text?.slice(0, 40)}"`);

      const business = connId ? await findByBizConnId(connId) : null;
      if (!business) {
        console.warn('[agent-bot] no business for conn_id:', connId);
        return NextResponse.json({ ok: true });
      }

      // Owner replied manually — log as outbound, don't AI-reply
      if (Number(bm.from?.id) === Number(business.owner_telegram_id)) {
        console.log('[agent-bot] owner manual reply, logging');
        if (bm.text && chatId) {
          const sb = supabase();
          const { data: conv } = await sb.from('conversations')
            .select('id')
            .eq('business_id', business.id)
            .eq('customer_telegram_id', String(chatId))
            .maybeSingle();
          if (conv?.id) {
            await sb.from('messages').insert({
              conversation_id: conv.id,
              business_id: business.id,
              direction: 'outbound',
              content: bm.text,
              content_type: 'text',
              status: 'sent',
              is_ai_generated: false,
              telegram_chat_id: chatId,
              sent_at: new Date().toISOString(),
            }).catch(e => console.warn('[agent-bot] log owner reply:', e.message));
          }
        }
        return NextResponse.json({ ok: true });
      }

      // Customer message → show typing then route through reply engine
      if (chatId && bm.text && !bm.text.startsWith('/')) {
        tg('sendChatAction', {
          chat_id: chatId,
          action: 'typing',
          business_connection_id: connId,
        }).catch(() => {});
      }

      await handleTenantUpdate(business, AGENT_TOKEN, update);
      return NextResponse.json({ ok: true });
    }

    // ── 3. Callback query — owner drafts, signup buttons, etc. ──────────
    if (update.callback_query) {
      const cq = update.callback_query;
      const cbData = cq.data || '';
      const cbUserId = String(cq.from?.id || '');
      const cbChatId = cq.message?.chat?.id;

      // ── Signup flow buttons (category, mode, switch_to_shared) ──
      if (cbData.startsWith('signup_cat_')) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const cat = cbData.replace('signup_cat_', '');
        const sess = signupSessions.get(cbUserId);
        if (sess) {
          sess.data.category = cat;
          sess.step = 'mode';
          signupSessions.set(cbUserId, sess);
          await tg('sendMessage', {
            chat_id: cbChatId,
            parse_mode: 'Markdown',
            text:
              `*Last step — how should customers reach you?*\n\n` +
              `⚡ *Use MiniMe directly* (recommended)\n` +
              `Customers get a unique link. Zero setup — you can add your own bot anytime.\n\n` +
              `🤖 *Get your own @YourShop_bot*\n` +
              `Create a dedicated bot via @BotFather. Takes ~60 seconds.`,
            reply_markup: { inline_keyboard: [
              [{ text: '⚡ Use MiniMe directly', callback_data: 'signup_mode_shared' }],
              [{ text: '🤖 Get my own bot',      callback_data: 'signup_mode_custom' }],
            ]},
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (cbData === 'signup_mode_shared' || cbData === 'signup_mode_custom') {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const sess = signupSessions.get(cbUserId);
        if (sess) {
          await finishSignup(cbChatId, cbUserId, cq.from, sess, cbData === 'signup_mode_custom');
          signupSessions.delete(cbUserId);
        }
        return NextResponse.json({ ok: true });
      }

      if (cbData === 'switch_to_shared') {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const business = await findByOwnerTelegramId(cbUserId);
        if (business) {
          const code = business.shop_code || shopCode();
          if (!business.shop_code) {
            await supabase().from('businesses').update({ shop_code: code, onboarding_completed: true }).eq('id', business.id);
          }
          await tg('sendMessage', {
            chat_id: cbChatId,
            parse_mode: 'Markdown',
            text: `✅ Switched to MiniMe direct mode!\n\n🔗 Share this with customers:\nt.me/MiniMeAgentBot?start=shop_${code}`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      // ── Owner/business callbacks (approve/edit/skip drafts, quotes, etc.) ──
      if (cq.from?.id) {
        const business = await findByOwnerTelegramId(cbUserId);
        if (business) {
          // Secretary mode: re-inject business_connection_id for replies
          if (business.telegram_biz_conn_id) {
            const customerChatId = cq.message?.reply_to_message?.chat?.id
              || cq.message?.chat?.id;
            if (customerChatId && String(customerChatId) !== cbUserId) {
              setBizConnId(String(customerChatId), business.telegram_biz_conn_id);
            }
          }
          await handleTenantUpdate(business, AGENT_TOKEN, update);
        } else {
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
        }
      }
      return NextResponse.json({ ok: true });
    }

    // ── 4. Normal message — owner, customer, or new user ──────────────────
    const msg = update.message || update.edited_message;
    if (!msg?.from?.id) return NextResponse.json({ ok: true });

    const chatId = msg.chat?.id;
    const text   = msg.text || '';
    console.log(`[agent-bot] message: from=${msg.from.id} text="${text.slice(0, 40)}"`);

    // Show typing bubble immediately — before any async DB work
    if (text && !text.startsWith('/start') && !text.startsWith('/help')) {
      tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    }

    // ── Step 1: Is sender a business OWNER? ─────────────────────────────
    const ownerBusiness = await findByOwnerTelegramId(String(msg.from.id));
    console.log('[agent-bot] owner lookup:', ownerBusiness ? ownerBusiness.name : 'not found');

    if (ownerBusiness) {
      // Owner with a business — route through full reply engine (commands, teach, orders, etc.)
      await handleTenantUpdate(ownerBusiness, AGENT_TOKEN, update);
      return NextResponse.json({ ok: true });
    }

    // ── Step 2: Is it /start shop_XXX? (customer deep link) ─────────────
    if (text.startsWith('/start')) {
      const startParam = text.split(' ')[1] || '';

      if (startParam.startsWith('shop_')) {
        const shopCode = startParam.slice(5); // strip "shop_"
        const business = await findByShopCode(shopCode);
        if (business) {
          console.log(`[agent-bot] deep link: shop_${shopCode} → ${business.name}`);
          // Route through reply engine as a customer /start
          await handleTenantUpdate(business, AGENT_TOKEN, update);
          return NextResponse.json({ ok: true });
        }
        console.warn(`[agent-bot] unknown shop_code: ${shopCode}`);
      }

      // No shop code — start conversational signup for new owners
      signupSessions.set(String(msg.from.id), {
        step: 'name',
        data: { owner_name: msg.from.first_name || null }
      });
      await tg('sendMessage', {
        chat_id: chatId,
        parse_mode: 'Markdown',
        text:
          `👋 *Welcome to MiniMe!*\n\n` +
          `I'm your AI sales assistant. Customers message you on Telegram — I reply for you, in your voice, 24/7.\n\n` +
          `Let's get you set up in 30 seconds.\n\n` +
          `*What's your business called?*\n` +
          `_(e.g. Selam Boutique, Bole Tech, Habesha Cafe)_`,
      });
      return NextResponse.json({ ok: true });
    }

    // ── Step 3: Is sender a known CUSTOMER? (follow-up message) ─────────
    const customerBusiness = await findLastBusinessForCustomer(String(msg.from.id));
    if (customerBusiness) {
      console.log(`[agent-bot] customer routed to: ${customerBusiness.name}`);
      await handleTenantUpdate(customerBusiness, AGENT_TOKEN, update);
      return NextResponse.json({ ok: true });
    }

    // ── Step 4: Signup in progress? ──────────────────────────────────────
    const session = signupSessions.get(String(msg.from.id));
    if (session) {
      return handleSignupStep(chatId, String(msg.from.id), text, update, session);
    }

    // ── Step 5: Unknown user — nudge to /start ────────────────────────────
    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `Send /start to set up your business with MiniMe!`,
    });
    return NextResponse.json({ ok: true });

  } catch (e) {
    console.error('[agent-bot webhook] unhandled error:', e.message, e.stack?.slice(0, 300));
    return NextResponse.json({ ok: true }); // always 200 so Telegram doesn't retry
  }
}

// ── Signup step handler ───────────────────────────────────────────────────
async function handleSignupStep(chatId, userId, text, update, session) {
  if (session.step === 'name') {
    if (!text || text.startsWith('/') || text.length < 2 || text.length > 60) {
      await tg('sendMessage', { chat_id: chatId, text: 'Please send your business name (2-60 characters).' });
      return NextResponse.json({ ok: true });
    }
    session.data.name = text.trim();
    session.step = 'category';
    signupSessions.set(userId, session);

    const buttons = [];
    for (let i = 0; i < CATEGORIES.length; i += 2) {
      const row = [{ text: CATEGORIES[i][0], callback_data: `signup_cat_${CATEGORIES[i][1]}` }];
      if (CATEGORIES[i + 1]) row.push({ text: CATEGORIES[i + 1][0], callback_data: `signup_cat_${CATEGORIES[i + 1][1]}` });
      buttons.push(row);
    }
    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `Great — *${text.trim()}* 🎉\n\n*What do you sell?*`,
      reply_markup: { inline_keyboard: buttons },
    });
    return NextResponse.json({ ok: true });
  }

  // Fallback for other steps if user types instead of tapping
  if (session.step === 'awaiting_token') {
    const tokenMatch = text.trim().match(/^(\d+:[A-Za-z0-9_-]{30,})$/);
    if (tokenMatch) {
      const business = await findByOwnerTelegramId(userId);
      if (business) {
        return connectBotToken(chatId, userId, tokenMatch[1], business);
      }
    } else {
      await tg('sendMessage', {
        chat_id: chatId,
        parse_mode: 'Markdown',
        text: `Paste the token from BotFather. It looks like:\n\`123456789:AAH-xxxx...\`\n\nOr tap *Use MiniMe directly* below to skip.`,
        reply_markup: { inline_keyboard: [[{ text: '⚡ Use MiniMe directly instead', callback_data: 'switch_to_shared' }]] },
      });
    }
  }

  return NextResponse.json({ ok: true });
}

// ── Finish signup — create business + reply ───────────────────────────────
async function finishSignup(chatId, userId, from, session, customBot) {
  const code = shopCode();
  const { data: business, error } = await supabase().from('businesses').insert({
    owner_telegram_id: Number(userId),
    owner_name: from.first_name || null,
    name: session.data.name,
    workspace_type: 'business',
    category: session.data.category || 'other',
    onboarding_completed: !customBot,
    brain_mode: true,
    trust_level: 2,
    bot_mode: customBot ? 'custom' : 'shared',
    shop_code: customBot ? null : code,
  }).select().single();

  if (error) {
    console.error('[signup] insert failed:', error);
    await tg('sendMessage', { chat_id: chatId, text: `❌ Setup failed: ${error.message}. Try /start again.` });
    return NextResponse.json({ ok: true });
  }

  if (!customBot) {
    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text:
        `✅ *${business.name} is live!*\n\n` +
        `Share this link with customers:\n🔗 t.me/MiniMeAgentBot?start=shop_${code}\n\n` +
        `*What to do next:*\n` +
        `1️⃣ Send a product photo (price in the caption)\n` +
        `2️⃣ \`/teach We deliver free over 1000 ETB\`\n` +
        `3️⃣ \`/rule Always mention warranty\`\n\n` +
        `Shadow mode is ON — every reply comes to you first for approval.`,
      reply_markup: { inline_keyboard: [[
        { text: '📱 Open Dashboard', web_app: { url: MINIAPP_BASE } },
      ]] },
    });
  } else {
    // Put owner in awaiting_token state
    signupSessions.set(userId, { step: 'awaiting_token', data: { businessId: business.id } });
    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text:
        `🤖 *Get your own bot in 60 seconds:*\n\n` +
        `1️⃣ Tap *Open BotFather* below\n` +
        `2️⃣ Send \`/newbot\`\n` +
        `3️⃣ Pick a display name (e.g. *${business.name}*)\n` +
        `4️⃣ Pick a username ending in \`bot\`\n` +
        `5️⃣ Copy the token BotFather sends\n` +
        `6️⃣ Paste it here — I'll set everything up!\n\n` +
        `_Token looks like: \`123456789:AAH-xxxx...\`_`,
      reply_markup: { inline_keyboard: [
        [{ text: '📱 Open BotFather', url: 'https://t.me/BotFather' }],
        [{ text: '⚡ Use MiniMe directly instead', callback_data: 'switch_to_shared' }],
      ]},
    });
  }
  return NextResponse.json({ ok: true });
}

// ── Connect bot token (paste from BotFather) ──────────────────────────────
async function connectBotToken(chatId, userId, token, business) {
  const placeholder = await tg('sendMessage', { chat_id: chatId, text: '⏳ Validating your bot…' });
  try {
    // Validate with Telegram
    const meResp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meJson = await meResp.json();
    if (!meJson.ok) {
      await tg('editMessageText', { chat_id: chatId, message_id: placeholder?.result?.message_id,
        text: `❌ Invalid token: ${meJson.description}\n\nMake sure you copied the whole token from BotFather.` });
      return NextResponse.json({ ok: true });
    }
    const botUsername = meJson.result.username;

    // Encrypt and store
    const enc = encrypt(token);
    const webhookSecret = randomSecret(24);
    const webhookUrl = `${WEB_URL}/api/telegram/webhook/${webhookSecret}`;

    // Register webhook on the new bot
    await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'edited_message', 'callback_query', 'pre_checkout_query'],
        drop_pending_updates: true,
      }),
    });

    // Set commands on the new bot
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: [
        { command: 'start', description: 'Start shopping' },
        { command: 'products', description: 'Browse products' },
        { command: 'help', description: 'Get help' },
      ]}),
    }).catch(() => {});

    // Update business
    await supabase().from('businesses').update({
      telegram_bot_token_enc: enc,
      telegram_bot_username: botUsername,
      webhook_secret: webhookSecret,
      bot_linked_at: new Date().toISOString(),
      onboarding_completed: true,
      bot_mode: 'custom',
    }).eq('id', business.id);

    signupSessions.delete(userId);

    await tg('editMessageText', {
      chat_id: chatId, message_id: placeholder?.result?.message_id,
      parse_mode: 'Markdown',
      text:
        `✅ *@${botUsername} is LIVE!*\n\n` +
        `🔗 https://t.me/${botUsername}\n\n` +
        `Share this with customers — they message it, MiniMe replies as your business.\n` +
        `Shadow mode is ON — every reply comes to you first.`,
      reply_markup: { inline_keyboard: [
        [{ text: '📱 Open Dashboard', web_app: { url: MINIAPP_BASE } }],
        [{ text: `📲 Test @${botUsername}`, url: `https://t.me/${botUsername}` }],
      ]},
    });
  } catch (e) {
    console.error('[connectBot]', e.message);
    await tg('editMessageText', { chat_id: chatId, message_id: placeholder?.result?.message_id,
      text: `❌ Error: ${e.message}. Try pasting the token again.` });
  }
  return NextResponse.json({ ok: true });
}
