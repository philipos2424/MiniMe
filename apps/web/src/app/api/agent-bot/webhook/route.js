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
import { handleTenantUpdate, learnFromOwnerReply } from '../../../../lib/server/replyEngine';
import { setBizConnId, setBizConnOwner, clearBizConnId } from '../../../../lib/server/telegramApi';
import { findByBizConnId, findById, findByOwnerTelegramId, findByShopCode, findLastBusinessForCustomer } from '../../../../lib/server/businesses';
import { encrypt, randomSecret } from '../../../../lib/server/crypto';
import { getSignupSession, setSignupSession, deleteSignupSession } from '../../../../lib/server/signupSession';
import { getShoppingContext, setShoppingContext, clearShoppingContext } from '../../../../lib/server/shoppingSession';
import { allowedUpdates, isPlatformBotToken } from '../../../../lib/server/telegramConfig';
import { ensureSharedWebhook } from '../../../../lib/server/sharedWebhookGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AGENT_TOKEN    = (process.env.TELEGRAM_BOT_TOKEN     || '').trim();
const WEBHOOK_SECRET = (process.env.AGENT_BOT_WEBHOOK_SECRET || '').trim();
const MINIAPP_BASE   = (process.env.NEXT_PUBLIC_APP_URL     || 'https://web-theta-one-68.vercel.app').trim();
const WEB_URL        = (process.env.WEB_URL || MINIAPP_BASE).replace(/\/$/, '');

// Signup session state is persisted via lib/server/signupSession.js (durable
// across serverless invocations). See migrations/021_signup_sessions.sql.

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

// ── Signup funnel logging ───────────────────────────────────────────────────
// Persist each signup milestone so conversion is a *number you can query*, not a
// thing you reverse-engineer from customer screenshots. Fully best-effort: a
// logging failure must NEVER break signup, so we swallow everything.
//   signup_started  → tapped /start, got asked for business name
//   signup_name_set → answered the name (the step that used to silently die)
//   signup_finished → business row created
// Query it: select event, count(distinct user_id) from funnel_events
//           where created_at > now() - interval '1 day' group by event;
async function logFunnel(event, userId, fields = {}) {
  try {
    await supabase().from('funnel_events').insert({
      event,
      user_id: userId == null ? null : String(userId),
      business_id: fields.business_id || null,
      meta: fields.meta || null,
    });
  } catch (e) {
    console.warn(`[funnel] ${event}:`, e.message);
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

    // Self-heal: confirm this bot's own webhook hasn't drifted (throttled to
    // ~once/15min per warm instance). Catches allowed_updates regressions that
    // would otherwise silence Secretary Mode without us noticing. Never throws.
    await ensureSharedWebhook();

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

      // ── CRITICAL: register the Business-API connection for this chat ──────
      // Every reply to a customer on the owner's personal Telegram MUST carry
      // business_connection_id, otherwise Telegram rejects it (the bot is not a
      // member of the customer's private chat) and the customer sees "typing…"
      // then silence. tg() auto-injects this from the _bizConnIds map keyed by
      // chatId — but ONLY if we populate it here, before handleTenantUpdate runs
      // the brain / reply engine. setBizConnOwner lets us DM the owner the fix
      // if Telegram still refuses (permission not granted).
      if (chatId && connId) {
        setBizConnId(String(chatId), connId);
        setBizConnOwner(connId, business.owner_private_chat_id || business.owner_telegram_id, business.id);
      }

      // ── Bot sender guard — NEVER AI-reply to another bot ──────────────
      // Telegram marks automated senders with from.is_bot. Notification bots
      // (Wallet, banks, delivery, and even @MiniMeAgentBot itself) trigger
      // endless reply loops if we answer them. Log and stop.
      if (bm.from?.is_bot) {
        console.log(`[agent-bot] business_message from bot (${bm.from?.username || bm.from?.id}) — skipping AI, no loop`);
        return NextResponse.json({ ok: true });
      }

      // Owner replied manually — log as outbound, don't AI-reply
      if (Number(bm.from?.id) === Number(business.owner_telegram_id)) {
        console.log('[agent-bot] owner manual reply, logging');
        if (bm.text && chatId) {
          const sb = supabase();
          // conversations has no customer_telegram_id column — resolve the
          // customer by telegram_id (BIGINT, UNIQUE per business) first, then
          // find their conversation by customer_id. Without this two-step
          // lookup the owner's manual reply was never logged and the learning
          // hook below never fired.
          const { data: cust } = await sb.from('customers')
            .select('id')
            .eq('business_id', business.id)
            .eq('telegram_id', chatId)
            .maybeSingle();
          const { data: conv } = cust?.id
            ? await sb.from('conversations')
                .select('id')
                .eq('business_id', business.id)
                .eq('customer_id', cust.id)
                .maybeSingle()
            : { data: null };
          if (conv?.id) {
            const { error: logErr } = await sb.from('messages').insert({
              conversation_id: conv.id,
              business_id: business.id,
              direction: 'outbound',
              content: bm.text,
              content_type: 'text',
              status: 'sent',
              is_ai_generated: false,
              telegram_chat_id: chatId,
              sent_at: new Date().toISOString(),
            });
            if (logErr) console.warn('[agent-bot] log owner reply:', logErr.message);

            // Evolve: if MiniMe just punted and the owner stepped in to answer,
            // learn that answer as an FAQ so MiniMe handles it next time.
            await learnFromOwnerReply(business, conv.id, bm.text, AGENT_TOKEN).catch(() => {});
          }
        }
        return NextResponse.json({ ok: true });
      }

      // ── Personal contact check — engage family/friends warmly, never pitch ──
      const senderTgId = String(bm.from?.id || '');
      const senderName = [bm.from?.first_name, bm.from?.last_name].filter(Boolean).join(' ') || bm.from?.username || 'Unknown';
      const nPrefs = business.notification_prefs || {};
      const personalContacts = nPrefs.personal_contacts || [];
      const contactEntry = personalContacts.find(c => String(c.telegram_id) === senderTgId);

      if (contactEntry) {
        // Known personal contact (family/friend). The owner wants the secretary
        // to chat with them too — warmly, context-aware, reading the history, and
        // never pitching the business. Route through the reply engine, which
        // detects the saved relationship and keeps the tone personal.
        console.log(`[agent-bot] personal contact (${contactEntry.relation}): ${senderName} — engaging personally`);
        if (chatId && bm.text && !bm.text.startsWith('/')) {
          tg('sendChatAction', { chat_id: chatId, action: 'typing', business_connection_id: connId }).catch(() => {});
        }
        try {
          await handleTenantUpdate(business, AGENT_TOKEN, update);
        } finally {
          if (chatId) clearBizConnId(String(chatId));
        }
        return NextResponse.json({ ok: true });
      }

      // First time this person messages in secretary mode?
      // Check if we've seen them before as a customer
      const sb = supabase();
      const { data: existingCustomer } = await sb
        .from('customers')
        .select('id, total_orders, name')
        .eq('business_id', business.id)
        .eq('telegram_id', Number(senderTgId))
        .maybeSingle();

      // ── UNKNOWN contact in secretary mode → NEVER auto-reply ──────────────
      // CRITICAL SAFETY. In secretary mode the bot speaks AS the owner on their
      // PERSONAL Telegram line. An unknown sender could be ANYONE — a friend, a
      // supplier, an investor, family. We must never let the AI answer as the
      // owner before the owner has vouched for who this is.
      //
      // Real incident that forced this: the bot replied to the owner's personal
      // contact with "I've got <X> noted down, working on your branding package,
      // moving faster on my end…" — fabricated commitments, sent AS the owner,
      // who never even saw it ("i didn't get any texts"). One bad message in your
      // own name to the wrong person costs a relationship, not a sale.
      //
      // So: alert the owner to classify, and STOP — no reply leaves the bot until
      // they tap "Customer". Known customers and saved personal contacts are
      // handled above and are unaffected (the owner already vouched for them).
      if (!existingCustomer) {
        const ownerChat = business.owner_private_chat_id || business.owner_telegram_id;
        if (ownerChat && bm.text) {
          await tg('sendMessage', {
            chat_id: ownerChat,
            parse_mode: 'Markdown',
            text: `👤 *New contact:* ${senderName}\n💬 "${(bm.text || '').slice(0, 160)}"\n\n🛑 *I haven't replied.* Who is this? I'll only answer as you if you tap *Customer*.`,
            reply_markup: { inline_keyboard: [
              [
                { text: '👨‍👩‍👧 Family', callback_data: `contact_personal_${senderTgId}_family` },
                { text: '👫 Friend', callback_data: `contact_personal_${senderTgId}_friend` },
              ],
              [
                { text: '🛒 Customer — reply for me', callback_data: `contact_customer_${senderTgId}` },
              ],
            ] },
          });
        }
        if (chatId) clearBizConnId(String(chatId));
        return NextResponse.json({ ok: true });
      }

      // Known customer → show typing then route through reply engine
      if (chatId && bm.text && !bm.text.startsWith('/')) {
        tg('sendChatAction', {
          chat_id: chatId,
          action: 'typing',
          business_connection_id: connId,
        }).catch(() => {});
      }

      try {
        await handleTenantUpdate(business, AGENT_TOKEN, update);
      } finally {
        if (chatId) clearBizConnId(String(chatId));
      }
      return NextResponse.json({ ok: true });
    }

    // ── 3. Callback query — owner drafts, signup buttons, etc. ──────────
    if (update.callback_query) {
      const cq = update.callback_query;
      const cbData = cq.data || '';
      const cbUserId = String(cq.from?.id || '');
      const cbChatId = cq.message?.chat?.id;

      // ── Contact type buttons (family/friend/customer) ──
      if (cbData.startsWith('contact_personal_') || cbData.startsWith('contact_customer_')) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const business = await findByOwnerTelegramId(cbUserId);
        if (business) {
          if (cbData.startsWith('contact_personal_')) {
            // Parse: contact_personal_{telegramId}_{relation}
            const parts = cbData.replace('contact_personal_', '').split('_');
            const contactTgId = parts.slice(0, -1).join('_'); // handle IDs with underscores
            const relation = parts[parts.length - 1]; // family or friend
            const prefs = business.notification_prefs || {};
            const existing = prefs.personal_contacts || [];
            // Find the sender name from the notification message
            const notifText = cq.message?.text || '';
            const nameMatch = notifText.match(/New contact:\*?\s*(.+)/);
            const contactName = nameMatch ? nameMatch[1].split('\n')[0].trim() : 'Unknown';
            if (!existing.some(c => String(c.telegram_id) === contactTgId)) {
              existing.push({
                telegram_id: contactTgId,
                name: contactName,
                relation, // 'family' or 'friend'
                added_at: new Date().toISOString(),
              });
              await supabase().from('businesses').update({
                notification_prefs: { ...prefs, personal_contacts: existing },
              }).eq('id', business.id);
            }
            const emoji = relation === 'family' ? '👨‍👩‍👧' : '👫';
            await tg('editMessageText', {
              chat_id: cbChatId,
              message_id: cq.message?.message_id,
              text: `${emoji} Got it — ${contactName} marked as ${relation}. I'll chat with them warmly as you, using your history together — and I'll never bring up the business.`,
            });
          } else {
            // contact_customer — REGISTER them as a real customer so future
            // messages get AI replies. Without this row the next message would be
            // "unknown" again and loop back to this same prompt. We do NOT retro-
            // answer the message that triggered the prompt (we never saw the
            // owner's intent for it) — the owner replies to that one themselves;
            // MiniMe takes over from their NEXT message on.
            const contactTgId = cbData.replace('contact_customer_', '');
            const notifText = cq.message?.text || '';
            const nameMatch = notifText.match(/New contact:\*?\s*(.+)/);
            const contactName = nameMatch ? nameMatch[1].split('\n')[0].trim() : 'Customer';
            try {
              const sb = supabase();
              const { data: exists } = await sb.from('customers').select('id')
                .eq('business_id', business.id)
                .eq('telegram_id', Number(contactTgId))
                .maybeSingle();
              if (!exists) {
                await sb.from('customers').insert({
                  business_id: business.id,
                  telegram_id: Number(contactTgId),
                  name: contactName,
                });
              }
            } catch (e) {
              console.warn('[agent-bot] register customer failed:', e.message);
            }
            await tg('editMessageText', {
              chat_id: cbChatId,
              message_id: cq.message?.message_id,
              text: `🛒 Got it — ${contactName} is a customer. I'll reply as you from their *next* message on.\n\n_(I didn't answer their last message — reply to that one yourself if it needs it.)_`,
              parse_mode: 'Markdown',
            });
          }
        }
        return NextResponse.json({ ok: true });
      }

      // ── Signup flow buttons (category, mode, switch_to_shared) ──
      if (cbData.startsWith('signup_cat_')) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const cat = cbData.replace('signup_cat_', '');
        const sess = await getSignupSession(cbUserId);
        if (sess) {
          sess.data.category = cat;
          sess.step = 'mode';
          await setSignupSession(cbUserId, sess);
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
        } else {
          // Session expired or lost — recover instead of leaving the tap dead.
          await tg('sendMessage', {
            chat_id: cbChatId,
            parse_mode: 'Markdown',
            text: `That signup timed out. Send /start to pick up where you left off.`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (cbData === 'signup_mode_shared' || cbData === 'signup_mode_custom') {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const sess = await getSignupSession(cbUserId);
        if (sess && sess.data?.name) {
          const isCustom = cbData === 'signup_mode_custom';
          await finishSignup(cbChatId, cbUserId, cq.from, sess, isCustom);
          // Shared mode is fully done → clear the session. Custom mode is NOT:
          // finishSignup just set the session to `awaiting_token` so the owner
          // can paste their BotFather token next. Deleting it here (the old bug)
          // wiped that state immediately. (Token paste is also caught by the
          // owner-block handler above, but keep the session honest regardless.)
          if (!isCustom) await deleteSignupSession(cbUserId);
        } else {
          // Session expired or lost — recover instead of leaving the tap dead.
          await tg('sendMessage', {
            chat_id: cbChatId,
            parse_mode: 'Markdown',
            text: `That signup timed out. Send /start and I'll set you up — it only takes a moment.`,
          });
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
            // Branded storefront link (shows the owner's business in previews),
            // not the raw t.me link (which previews as "MiniMe").
            text: `✅ Switched to MiniMe direct mode!\n\n🔗 Share this with customers:\n${WEB_URL}/shop/${code}`,
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

    // ── Bot sender guard — never reply to another bot (loop prevention) ──
    if (msg.from?.is_bot) {
      console.log(`[agent-bot] message from bot (${msg.from?.username || msg.from?.id}) — ignoring`);
      return NextResponse.json({ ok: true });
    }

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
      // Opt-out shortcut for platform re-engagement nudges. If the owner replies
      // with bare "STOP" / "stop" / "/stop_nudges", flip the flag we read in the
      // owner-nudges cron and confirm. Cheap, idempotent, and means anyone who
      // doesn't want our reminders can silence them in three letters.
      const stopMatch = /^\s*(stop|stop\s+nudges|\/stop_?nudges)\s*$/i.test(text);
      if (stopMatch) {
        const sb = supabase();
        const prefs = { ...(ownerBusiness.notification_prefs || {}) };
        prefs.owner_nudges = {
          ...(prefs.owner_nudges || {}),
          opted_out: true,
          opted_out_at: new Date().toISOString(),
          opted_out_reason: 'owner_replied_stop',
        };
        await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', ownerBusiness.id);
        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'Markdown',
          text:
            `✅ *Stopped* — you won't get any more re-engagement reminders from MiniMe.\n\n` +
            `Order updates, customer drafts, and other essentials still come through as before. ` +
            `To turn reminders back on, just message me here.`,
        });
        return NextResponse.json({ ok: true });
      }

      // Owner pasting a BotFather token to connect their own bot. This MUST be
      // handled here, before any other owner routing: once finishSignup created
      // the business, the owner-check intercepts every owner message — so a
      // token pasted at the "awaiting_token" step was being treated as a normal
      // chat message and the bot never linked. That's why ~40% of custom-bot
      // signups sat with no token (Salem, Yeab, Openai, …) and "didn't respond
      // to inboxes": customers had no bot to message. Strict token shape + only
      // when this business has no bot yet, so it never eats real chat.
      const tokenMatch = text.trim().match(/^(\d+:[A-Za-z0-9_-]{30,})$/);
      if (tokenMatch && !ownerBusiness.telegram_bot_token_enc) {
        console.log(`[agent-bot] owner ${msg.from.id} pasting bot token to link ${ownerBusiness.name}`);
        await clearShoppingContext(msg.from.id);
        await logFunnel('bot_token_pasted', msg.from.id, { business_id: ownerBusiness.id });
        return connectBotToken(chatId, String(msg.from.id), tokenMatch[1], ownerBusiness);
      }

      const startParam = text.startsWith('/start') ? (text.split(' ')[1] || '') : '';

      // (a) Owner explicitly opened ANOTHER business's shop link. The owner
      // short-circuit used to swallow this and dump them on their own dashboard
      // — so an owner could never visit a peer's shop (and founders couldn't QA
      // client links). Honor the explicit intent: route them to that business as
      // a CUSTOMER, and remember it so plain-text follow-ups keep flowing there.
      if (startParam.startsWith('shop_') && startParam !== `shop_${ownerBusiness.shop_code}`) {
        const other = await findByShopCode(startParam.slice(5));
        if (other && other.id !== ownerBusiness.id) {
          console.log(`[agent-bot] owner ${msg.from.id} shopping at ${other.name} via ${startParam}`);
          await setShoppingContext(msg.from.id, other.id);
          await handleTenantUpdate(other, AGENT_TOKEN, update);
          return NextResponse.json({ ok: true });
        }
      }

      // (b) Owner tapped their OWN shop link. The shared bot is ONE chat keyed by
      // Telegram user-id, so an owner literally cannot be a customer of their own
      // bot in the same thread — they always land on the owner side. Explain it
      // instead of silently showing the menu.
      if (startParam && startParam === `shop_${ownerBusiness.shop_code}`) {
        await clearShoppingContext(msg.from.id);
        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'Markdown',
          text:
            `🔗 *That's your own shop link* — it's for sharing with *customers*, not for testing here.\n\n` +
            `Because this is your account, MiniMe always opens *your* dashboard, not a customer view.\n\n` +
            `*To see what customers see:*\n` +
            `• Send \`/preview do you have X? how much?\` — I'll show you the exact reply a customer would get.\n` +
            `• Or open the link from a *different* phone / Telegram account.`,
        });
        return NextResponse.json({ ok: true });
      }

      // (c) Owner is mid-shopping at another business (sticky context) and sent
      // plain text — keep routing those follow-ups to that business as a customer.
      // ANY slash-command falls through to (d) and returns them to their own
      // dashboard, so an owner can never get locked out of their own account.
      if (!text.startsWith('/')) {
        const shopBizId = await getShoppingContext(msg.from.id);
        if (shopBizId && shopBizId !== ownerBusiness.id) {
          const other = await findById(shopBizId);
          if (other) {
            await handleTenantUpdate(other, AGENT_TOKEN, update);
            return NextResponse.json({ ok: true });
          }
          // business vanished — drop the stale context and fall through to owner
          await clearShoppingContext(msg.from.id);
        }
      }

      // (d) Normal owner traffic (commands, teach, orders, plain text). A slash
      // command is an explicit "I'm the owner now" signal — clear any shopping
      // context so they're firmly back on their own side.
      if (text.startsWith('/')) {
        await clearShoppingContext(msg.from.id);
        // Measure which features owners actually reach for, and how often. Only
        // discrete slash-commands are logged (intent signals); raw message volume
        // is already queryable from the conversations tables, so we don't double-log.
        const cmd = text.split(/\s/)[0].slice(0, 32).toLowerCase();
        await logFunnel('command_used', msg.from.id, { business_id: ownerBusiness.id, meta: { cmd } });
      }
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

      // No shop code — start conversational signup for new owners.
      // Only count a *fresh* start (a repeated /start mid-session isn't a new
      // funnel entry) so the conversion number stays honest.
      const priorSession = await getSignupSession(String(msg.from.id));
      if (!priorSession) await logFunnel('signup_started', msg.from.id);
      await setSignupSession(String(msg.from.id), {
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

    // ── Step 3: Signup in progress? (MUST come before customer routing) ──
    // An active signup is an explicit intent and has to beat an *incidental*
    // past-customer relationship. Many new owners explore MiniMe as a customer
    // first (they tap a shop link — even their own ?start=shop_… ), which writes
    // a `customers` row. If the known-customer check ran first (as it used to),
    // their signup reply ("Aster Consulting") got hijacked into a customer chat
    // and the signup silently stalled — the registration bug owners reported.
    const session = await getSignupSession(String(msg.from.id));
    if (session) {
      return handleSignupStep(chatId, String(msg.from.id), text, update, session);
    }

    // ── Step 4: Is sender a known CUSTOMER? (follow-up message) ─────────
    const customerBusiness = await findLastBusinessForCustomer(String(msg.from.id));
    if (customerBusiness) {
      console.log(`[agent-bot] customer routed to: ${customerBusiness.name}`);
      await handleTenantUpdate(customerBusiness, AGENT_TOKEN, update);
      return NextResponse.json({ ok: true });
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
    await setSignupSession(userId, session);
    await logFunnel('signup_name_set', userId, { meta: { name: session.data.name } });

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
    await logFunnel('signup_failed', userId, { meta: { error: error.message } });
    await tg('sendMessage', { chat_id: chatId, text: `❌ Setup failed: ${error.message}. Try /start again.` });
    return NextResponse.json({ ok: true });
  }

  await logFunnel('signup_finished', userId, {
    business_id: business.id,
    meta: { bot_mode: customBot ? 'custom' : 'shared' },
  });

  if (!customBot) {
    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text:
        `✅ *${business.name} is live!*\n\n` +
        // Branded storefront page — previews as the owner's business, not MiniMe.
        `Share this link with customers:\n🔗 ${WEB_URL}/shop/${code}`,
      reply_markup: { inline_keyboard: [[
        { text: '📱 Open Dashboard', web_app: { url: MINIAPP_BASE } },
      ]] },
    });
    // Don't dump a command cheat-sheet and walk away — that's the onboarding
    // cliff where owners stall with an empty brain. Carry the signup momentum
    // straight into the guided interview, which asks plain questions and fills
    // the knowledge base + catalog from the answers. Best-effort: if it throws,
    // the business is already live and the owner can run /learn manually.
    try {
      const { startOwnerInterview } = await import('../../../../lib/server/ownerInterview');
      await startOwnerInterview(AGENT_TOKEN, business, chatId);
      await logFunnel('interview_autostarted', userId, { business_id: business.id });
    } catch (e) {
      console.warn('[signup] auto-start interview failed (non-fatal):', e.message);
    }
  } else {
    // Put owner in awaiting_token state
    await setSignupSession(userId, { step: 'awaiting_token', data: { businessId: business.id } });
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
  // CRITICAL: reject MiniMe's own system bot tokens. If the owner pastes the
  // shared @MiniMeAgentBot token, linking it as a "custom bot" re-points the
  // shared webhook to a tenant path and silences the whole platform.
  if (isPlatformBotToken(token)) {
    await tg('sendMessage', { chat_id: chatId,
      text: '❌ That is a MiniMe system bot token, not your own. Create a fresh bot with @BotFather and paste that token — or tap "Use MiniMe directly instead" to skip the bot entirely.' });
    return NextResponse.json({ ok: true });
  }
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
        allowed_updates: allowedUpdates(),
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

    await deleteSignupSession(userId);

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
