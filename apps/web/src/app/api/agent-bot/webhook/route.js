/**
 * POST /api/agent-bot/webhook
 *
 * Webhook for the main MiniMe bot (TELEGRAM_BOT_TOKEN).
 * This handles two separate use cases in one endpoint:
 *
 * 1. Telegram Business API — owner connects personal Telegram account.
 *    When a business owner goes to Telegram Settings → Business → Chatbots
 *    and adds the MiniMe bot, ALL customer messages to their personal account
 *    flow through here as `business_message` updates. MiniMe replies on their
 *    behalf using the same AI engine as the per-tenant bots.
 *
 * 2. Normal owner interaction — owner messages the main MiniMe bot directly
 *    (e.g. /start during onboarding, dashboard commands before their own bot
 *    is set up).
 *
 * Setup: run GET /api/agent-bot/setup once to register this webhook with Telegram.
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabase } from '../../../../lib/server/db';
import { handleTenantUpdate } from '../../../../lib/server/replyEngine';
import { findByBizConnId, findByOwnerTelegramId } from '../../../../lib/server/businesses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AGENT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.AGENT_BOT_WEBHOOK_SECRET;
const MINIAPP_BASE  = process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app';

async function tg(method, body) {
  if (!AGENT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${AGENT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  } catch { return null; }
}

export async function POST(request) {
  try {
    // Verify webhook secret
    if (WEBHOOK_SECRET) {
      const headerSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
      const a = Buffer.from(headerSecret);
      const b = Buffer.from(WEBHOOK_SECRET);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }

    if (!AGENT_TOKEN) {
      return NextResponse.json({ ok: true, skipped: 'no_token' });
    }

    const update = await request.json();

    // ── 1. Business connection — owner connects/disconnects personal account ──
    if (update.business_connection) {
      const conn = update.business_connection;
      const ownerId = conn.user?.id;

      if (ownerId) {
        const business = await findByOwnerTelegramId(String(ownerId));
        if (business) {
          await supabase()
            .from('businesses')
            .update({ telegram_biz_conn_id: conn.is_enabled ? conn.id : null })
            .eq('id', business.id);
        }
      }

      if (conn.is_enabled) {
        await tg('sendMessage', {
          chat_id: conn.user_chat_id,
          parse_mode: 'Markdown',
          text: `✅ *MiniMe is now connected to your account!*\n\nI'll handle customer messages automatically — in your voice, 24/7. Customers who message you on Telegram will get instant AI replies.\n\n• You can still reply manually anytime\n• I'll learn from everything you write\n• Send me any message here to teach me, check orders, or update settings\n\nShare your Telegram with customers and let me handle the rest. 🚀`,
        });
      } else {
        await tg('sendMessage', {
          chat_id: conn.user_chat_id,
          text: "👋 MiniMe disconnected from your personal account. You'll handle messages manually. You can reconnect anytime from Telegram Settings → Business → Chatbots.",
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ── 2. Business message — customer messaged owner's personal account ──
    if (update.business_message || update.edited_business_message) {
      const bm = update.business_message || update.edited_business_message;
      const connId = bm.business_connection_id;

      let business = connId ? await findByBizConnId(connId) : null;

      // Fallback: if connId isn't stored yet (race), find by owner's chat
      // business_message.chat is the CUSTOMER's chat — use from.id via connection lookup
      if (!business && connId) {
        console.warn('[agent-bot] conn not found for id:', connId);
        return NextResponse.json({ ok: true });
      }
      if (!business) return NextResponse.json({ ok: true });

      // Owner replied manually from personal account — log it but don't AI-reply
      const isOwnerReply = Number(bm.from?.id) === Number(business.owner_telegram_id);
      if (isOwnerReply) {
        // Save the owner's manual reply as outbound message (fire-and-forget)
        if (bm.text) {
          const sb = supabase();
          try {
            const { findOrCreateCustomer, findOrCreateConversation } = await import('../../../../lib/server/replyEngine');
            // We can't easily import these — save via direct DB insert
            const chatId = bm.chat?.id;
            if (chatId) {
              const { data: conv } = await sb
                .from('conversations')
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
                }).catch(() => {});
              }
            }
          } catch {}
        }
        return NextResponse.json({ ok: true });
      }

      // Customer message — route through reply engine
      // typing indicator
      const chatId = bm.chat?.id;
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

    // ── 3. Normal message — owner directly messages the MiniMe bot ───────
    const msg = update.message || update.edited_message;
    if (msg?.from?.id) {
      const business = await findByOwnerTelegramId(String(msg.from.id));
      if (business) {
        // Route through normal reply engine — isOwner will be true, gets dashboard
        await handleTenantUpdate(business, AGENT_TOKEN, update);
      } else {
        // No business found — this is a new user or the bot received a message
        // from someone not yet onboarded
        if (msg.text?.startsWith('/start')) {
          await tg('sendMessage', {
            chat_id: msg.chat.id,
            parse_mode: 'Markdown',
            text: `👋 *Welcome to MiniMe!*\n\nMiniMe gives your business a 24/7 AI assistant on Telegram.\n\nTo get started, open the MiniMe app:`,
            reply_markup: { inline_keyboard: [[
              { text: '📱 Open MiniMe', web_app: { url: MINIAPP_BASE } },
            ]]},
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[agent-bot webhook]', e.message);
    return NextResponse.json({ ok: true }); // always 200 so Telegram doesn't retry
  }
}
