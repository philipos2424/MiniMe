/**
 * Dimts link — Dimts records the owner's phone calls. When the owner tells a
 * caller "I'll send it to you on Telegram", Dimts asks MiniMe to send it, and
 * MiniMe writes the message from the business's own catalog (Dimts knows what
 * was promised, MiniMe knows the prices) and sends it in the customer's chat.
 *
 * Telegram only lets a bot message someone who has chatted with it, so a caller
 * who is not yet a Telegram customer gets the message the moment they share
 * their number with the bot (flushWaitingForCustomer), for up to WAIT_DAYS.
 */
import { randomUUID } from 'node:crypto';
import { supabase } from './db';
import { tg } from './telegramApi';
import { sendAsOwnerOrBot } from './sendAs';
import { loggedCompletion } from './openai-wrapper';
import { MODEL_MINI } from './constants';
import { samePhone, phoneTail, signBody, WAIT_DAYS } from './dimtsLogic.mjs';

const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const dimtsBase = () => (process.env.DIMTS_BASE_URL || 'https://dimts.vercel.app').replace(/\/$/, '');
export const dimtsSecret = () => (process.env.DIMTS_LINK_SECRET || '').trim();

/** Signed POST to Dimts. Returns parsed JSON or throws. */
async function dimtsPost(path, payload) {
  const secret = dimtsSecret();
  if (!secret) throw new Error('DIMTS_LINK_SECRET is not set');
  const body = JSON.stringify(payload);
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${dimtsBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': timestamp,
      'webhook-signature': signBody(secret, id, timestamp, body) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `dimts_${res.status}`), { code: data.error });
  return data;
}

/** Owner tapped "Connect MiniMe" in Dimts, which opened /start dimts_<token>. */
export async function linkDimts({ token, business }) {
  const { user_id } = await dimtsPost('/webhooks/minime/link/confirm', {
    token, business_id: business.id, business_name: business.name,
  });
  if (!user_id) throw new Error('dimts_link_failed');
  const sb = supabase();
  // One Dimts account per business and the reverse: a re-link moves it.
  await sb.from('dimts_links').delete().eq('dimts_user_id', user_id);
  const { error } = await sb.from('dimts_links')
    .upsert({ business_id: business.id, dimts_user_id: user_id, linked_at: new Date().toISOString() }, { onConflict: 'business_id' });
  if (error) throw new Error(error.message);
}

/** Dimts unlinked from its side. */
export async function unlinkDimts(dimtsUserId) {
  await supabase().from('dimts_links').delete().eq('dimts_user_id', dimtsUserId);
}

async function findTelegramCustomer(sb, businessId, phone) {
  const { data } = await sb.from('customers')
    .select('id, name, phone, telegram_id')
    .eq('business_id', businessId).not('telegram_id', 'is', null)
    .ilike('phone', `%${phoneTail(phone)}`).limit(20);
  return (data || []).find(c => samePhone(c.phone, phone)) || null;
}

/**
 * Write the message from what was promised, the owner's draft from the call,
 * and the catalog. Falls back to the draft if the model is unavailable.
 */
async function composeMessage(business, req) {
  const { data: products } = await supabase().from('products')
    .select('name, price, currency, stock_quantity, description')
    .eq('business_id', business.id).eq('is_active', true).order('name').limit(150);
  const catalog = (products || []).map(p =>
    `- ${p.name}: ${p.price ?? '?'} ${p.currency || ''}${p.stock_quantity === 0 ? ' (out of stock)' : ''}${p.description ? ` — ${String(p.description).slice(0, 120)}` : ''}`,
  ).join('\n') || '(no catalog)';
  try {
    const r = await loggedCompletion({
      route: 'dimts_followup',
      business_id: business.id,
      bypass_credit_check: true,
      model: MODEL_MINI,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: `You write one Telegram message from ${business.name} to a customer, right after a phone call in which the owner promised to send them something.
Use only facts from the call draft and the catalog below. Never invent prices, stock, dates or links. If what was promised is not in the catalog, send the draft's content as it is, without guessing.
Plain text, no Markdown. Short and warm, like the owner wrote it. Write in ${req.language === 'am' ? 'Amharic' : 'English'}.
Reply with the message text only.

Catalog:
${catalog}` },
        { role: 'user', content: `Customer: ${req.caller_name || 'unknown name'}\nPromised on the call: ${req.request}\nDraft from the call: ${req.draft}` },
      ],
    });
    const text = (r?.choices?.[0]?.message?.content || '').trim();
    if (text && text.length <= 4000) return text;
  } catch (e) {
    console.warn('[dimts] compose failed, sending the call draft:', e.message);
  }
  return req.draft;
}

async function rememberOutbound(sb, business, customer, text) {
  const { data: conv } = await sb.from('conversations').select('id')
    .eq('business_id', business.id).eq('customer_id', customer.id)
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (!conv) return;
  await sb.from('messages').insert({ conversation_id: conv.id, business_id: business.id, customer_id: customer.id,
    direction: 'outbound', content: text, content_type: 'text' }).then(() => {}, () => {});
}

async function tellOwner(business, text) {
  const chatId = business.owner_private_chat_id || business.owner_telegram_id;
  if (!chatId || !AGENT_TOKEN) return;
  await tg(AGENT_TOKEN, 'sendMessage', { chat_id: chatId, text }).catch(() => {});
}

/**
 * Dimts' request to send. Idempotent on send_id: a retried request returns
 * the first outcome instead of messaging the customer twice.
 * @returns {{ status: 'sent'|'waiting'|'failed', error?: string }}
 */
export async function handleDimtsSend(req) {
  const sb = supabase();
  const { data: link } = await sb.from('dimts_links').select('business_id').eq('dimts_user_id', req.user_id).maybeSingle();
  if (!link) return { status: 'failed', error: 'not_linked' };

  const { data: prior } = await sb.from('dimts_deliveries').select('status, error').eq('dimts_send_id', req.send_id).maybeSingle();
  if (prior) return { status: prior.status, ...(prior.error ? { error: prior.error } : {}) };

  const { data: business } = await sb.from('businesses').select('*').eq('id', link.business_id).maybeSingle();
  if (!business) return { status: 'failed', error: 'not_linked' };

  const message = await composeMessage(business, req);
  const customer = await findTelegramCustomer(sb, business.id, req.phone);
  const row = { business_id: business.id, dimts_send_id: req.send_id, phone: req.phone,
    customer_id: customer?.id || null, message, status: 'waiting' };
  // Claim the send id before messaging anyone, so two concurrent retries can't both send.
  const { error: claimErr } = await sb.from('dimts_deliveries').insert(row);
  if (claimErr) {
    const { data: again } = await sb.from('dimts_deliveries').select('status').eq('dimts_send_id', req.send_id).maybeSingle();
    return { status: again?.status || 'failed' };
  }

  const who = req.caller_name || req.phone;
  if (!customer) {
    await tellOwner(business, `📞 After your call with ${who}: they haven't messaged you on Telegram yet, so I'll send this as soon as they share their number with your bot:\n\n${message}`);
    return { status: 'waiting' };
  }

  const sent = await sendAsOwnerOrBot({ sb, business, chatId: customer.telegram_id, payload: { text: message } });
  if (!sent.ok) {
    const error = sent.result?.description?.slice(0, 200) || sent.error || 'telegram_send_failed';
    await sb.from('dimts_deliveries').update({ status: 'failed', error }).eq('dimts_send_id', req.send_id);
    await tellOwner(business, `⚠️ I couldn't send ${who} the Telegram message you promised on your call. Please send it yourself:\n\n${message}`);
    return { status: 'failed', error: 'telegram_send_failed' };
  }
  await sb.from('dimts_deliveries').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('dimts_send_id', req.send_id);
  await rememberOutbound(sb, business, customer, message);
  await tellOwner(business, `✅ Sent to ${who} on Telegram, as you promised on the call:\n\n${message}`);
  return { status: 'sent' };
}

/**
 * A customer just shared their phone number with the business's bot: deliver
 * anything Dimts left waiting for that number. Best-effort; never throws.
 */
export async function flushWaitingForCustomer({ business, customer, phone, token, chatId }) {
  try {
    const sb = supabase();
    const since = new Date(Date.now() - WAIT_DAYS * 86_400_000).toISOString();
    const { data: waiting } = await sb.from('dimts_deliveries').select('id, dimts_send_id, phone, message')
      .eq('business_id', business.id).eq('status', 'waiting').gte('created_at', since).order('created_at');
    for (const item of (waiting || []).filter(w => samePhone(w.phone, phone))) {
      // Claim first: only one concurrent flush may send each message.
      const { data: claimed } = await sb.from('dimts_deliveries')
        .update({ status: 'sent', sent_at: new Date().toISOString(), customer_id: customer.id })
        .eq('id', item.id).eq('status', 'waiting').select('id');
      if (!claimed?.length) continue;
      const res = await tg(token, 'sendMessage', { chat_id: chatId, text: item.message });
      const ok = !!res?.ok;
      if (!ok) await sb.from('dimts_deliveries').update({ status: 'failed', error: 'telegram_send_failed' }).eq('id', item.id);
      else await rememberOutbound(sb, business, customer, item.message);
      await dimtsPost('/webhooks/minime/deliveries', { send_id: item.dimts_send_id, status: ok ? 'sent' : 'failed' })
        .catch(e => console.warn('[dimts] status callback failed:', e.message));
    }
  } catch (e) {
    console.warn('[dimts] flush failed:', e.message);
  }
}
