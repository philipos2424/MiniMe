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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AGENT_TOKEN    = (process.env.TELEGRAM_BOT_TOKEN     || '').trim();
const WEBHOOK_SECRET = (process.env.AGENT_BOT_WEBHOOK_SECRET || '').trim();
const MINIAPP_BASE   = (process.env.NEXT_PUBLIC_APP_URL     || 'https://web-theta-one-68.vercel.app').trim();

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

    // ── 3. Callback query — owner taps approve/edit/skip on a draft ─────────
    // This handles secretary mode shadow-mode approvals coming through the agent bot
    if (update.callback_query) {
      const cq = update.callback_query;
      const ownerId = cq.from?.id;
      if (ownerId) {
        const business = await findByOwnerTelegramId(String(ownerId));
        if (business) {
          // If this business is in secretary mode, re-inject the connection ID
          // so any reply the approval sends goes through the business_connection
          if (business.telegram_biz_conn_id) {
            // The customer chat ID is encoded in the message the button was on
            // We'll look it up from the draft via the callback data message context
            const customerChatId = cq.message?.reply_to_message?.chat?.id
              || cq.message?.chat?.id;
            if (customerChatId && String(customerChatId) !== String(ownerId)) {
              setBizConnId(String(customerChatId), business.telegram_biz_conn_id);
            }
          }
          await handleTenantUpdate(business, AGENT_TOKEN, update);
        } else {
          // No business — just answer the callback so the button spinner stops
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

      // No shop code or unknown — show onboarding
      await tg('sendMessage', {
        chat_id: chatId,
        parse_mode: 'Markdown',
        text: `👋 *Welcome to MiniMe!*\n\nI'm your AI business assistant for Telegram.\n\nGet set up in 90 seconds — open the app below:`,
        reply_markup: { inline_keyboard: [[
          { text: '📱 Open MiniMe App', web_app: { url: MINIAPP_BASE } },
        ]] },
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

    // ── Step 4: Unknown user — show help ────────────────────────────────
    if (text.startsWith('/help')) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Open MiniMe to get started: ' + MINIAPP_BASE,
      });
    } else {
      await tg('sendMessage', {
        chat_id: chatId,
        parse_mode: 'Markdown',
        text: `👋 *Welcome to MiniMe!*\n\nI'm your AI business assistant for Telegram.\n\nOpen the app below to set up your business:`,
        reply_markup: { inline_keyboard: [[
          { text: '📱 Open MiniMe App', web_app: { url: MINIAPP_BASE } },
        ]] },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[agent-bot webhook] unhandled error:', e.message, e.stack?.slice(0, 300));
    return NextResponse.json({ ok: true }); // always 200 so Telegram doesn't retry
  }
}
