/**
 * Secretary ↔ owner loop, the I/O side (logic and copy in ../secretaryPeople.mjs):
 *   maybeAskWho        — ask about ONE unclear person, right when it matters
 *   handleRelayCallback — "✍️ Answer Hanna" / "🔕 No evening recap" buttons
 *   handleRelayAnswer   — the owner's typed answer → sent to that person as the owner
 *   sendSecretaryRecap  — the evening "your day on Telegram" message
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { sendMarkdownSafe } from './tgEscape.mjs';
import {
  shouldAskWho, nextAsks, askWhoText, parseRelay, activeRelay, relayPromptText, relaySentText,
  recapText, recapKeyboard, addisDate,
} from '../secretaryPeople.mjs';
import { whoKeyboard } from '../whoIsWho.mjs';
import { openPromises } from '../secretaryBrain.mjs';

const MD = { parse_mode: 'Markdown', disable_web_page_preview: true };
const AGENT_TOKEN = () => (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ownerChatOf = (b) => b.owner_private_chat_id || b.owner_telegram_id;
const say = (token, body) => sendMarkdownSafe(b => tg(token, 'sendMessage', b), body);
const nameOf = (conv, cp) => cp?.name || conv?.customers?.name || conv?.customers?.telegram_username || 'them';

async function freshPrefs(id) {
  const { data } = await supabase().from('businesses').select('notification_prefs').eq('id', id).maybeSingle();
  return data?.notification_prefs || {};
}
async function patchPrefs(business, patch) {
  const prefs = await freshPrefs(business.id);
  const next = { ...prefs, ...patch };
  await supabase().from('businesses').update({ notification_prefs: next }).eq('id', business.id);
  business.notification_prefs = next;
  return next;
}

/**
 * After a Secretary reply: if we still can't place this person after a real
 * exchange, ask the owner about them alone (a few times a day, daytime only).
 */
export async function maybeAskWho(business, conversation, customer) {
  try {
    const token = AGENT_TOKEN();
    const chatId = ownerChatOf(business);
    if (!token || !chatId || !conversation?.id) return false;
    // Cheap check on what we already have — most messages stop here.
    const known = conversation.metadata?.contact_profile;
    if (known && (known.owner_set || known.asked_at || known.spam || (known.relationship && known.relationship !== 'unknown'))) return false;
    const sb = supabase();
    const { data: conv } = await sb.from('conversations').select('id, metadata').eq('id', conversation.id).maybeSingle();
    const cp = conv?.metadata?.contact_profile;
    const tgId = customer?.telegram_id ? String(customer.telegram_id) : null;
    const isPersonal = !!tgId && (business.notification_prefs?.personal_contacts || []).some(p => String(p.telegram_id) === tgId);
    const { count } = await sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id).eq('direction', 'inbound');
    const prefs = await freshPrefs(business.id);
    if (!shouldAskWho(cp, { inboundCount: count || 0, asks: prefs.who_asks, isPersonal })) return false;

    const { data: last } = await sb.from('messages').select('content').eq('conversation_id', conversation.id)
      .eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1);
    // Mark first, so two messages arriving together never ask twice.
    await sb.from('conversations').update({
      metadata: { ...(conv.metadata || {}), contact_profile: { ...cp, asked_at: new Date().toISOString() } },
    }).eq('id', conversation.id);
    await patchPrefs(business, { who_asks: nextAsks(prefs.who_asks) });

    const name = nameOf({ customers: customer }, cp);
    const kb = whoKeyboard([{ id: conversation.id, metadata: { contact_profile: cp }, customers: customer }]).slice(1); // buttons only
    await say(token, { chat_id: chatId, text: askWhoText({ name, lastMessage: last?.[0]?.content, notes: cp.notes }), reply_markup: { inline_keyboard: kb }, ...MD });
    return true;
  } catch (e) {
    console.warn('[secretary ask-who]', e.message);
    return false;
  }
}

/** sra_<conversationId> and srec_off buttons. Caller checks it's the owner. */
export async function handleRelayCallback({ token, business, chatId, data, answer }) {
  if (data === 'srec_off') {
    await patchPrefs(business, { secretary_recap: { enabled: false } });
    await answer('Off');
    await say(token, { chat_id: chatId, text: "🔕 OK — no evening recap. I'll still tell you right away when someone is waiting for you.", ...MD });
    return true;
  }
  const conversationId = parseRelay(data);
  if (!conversationId) return false;
  const { data: conv } = await supabase().from('conversations')
    .select('id, metadata, customers(name, telegram_id, telegram_username)')
    .eq('id', conversationId).eq('business_id', business.id).maybeSingle();
  if (!conv?.customers?.telegram_id) { await answer('Not found'); return true; }
  const name = nameOf(conv, conv.metadata?.contact_profile);
  await patchPrefs(business, { secretary_relay: { conversation_id: conv.id, name, at: new Date().toISOString() } });
  await answer('✍️');
  await say(token, { chat_id: chatId, text: relayPromptText(name), ...MD });
  return true;
}

/**
 * The owner's next message after "✍️ Answer X": send it to X from the owner's
 * account (the Secretary connection) and log it as the owner's own reply, so
 * the open promise closes and Secretary learns the answer.
 */
export async function handleRelayAnswer({ token, business, chatId, msg }) {
  const relay = activeRelay(business.notification_prefs);
  if (!relay) return false;
  const text = String(msg.text || '').trim();
  if (!text) return false;
  if (/^\/\w+/.test(text)) { // any command cancels
    await patchPrefs(business, { secretary_relay: null });
    if (/^\/cancel\b/i.test(text)) { await say(token, { chat_id: chatId, text: 'OK, cancelled.' }); return true; }
    return false;
  }
  const sb = supabase();
  const { data: conv } = await sb.from('conversations')
    .select('id, customers(name, telegram_id)')
    .eq('id', relay.conversation_id).eq('business_id', business.id).maybeSingle();
  await patchPrefs(business, { secretary_relay: null });
  const to = conv?.customers?.telegram_id;
  const connId = business.telegram_biz_conn_id;
  if (!to || !connId) {
    await say(token, { chat_id: chatId, text: relaySentText(relay.name, false, 'Secretary is not connected'), ...MD });
    return true;
  }
  const res = await tg(AGENT_TOKEN(), 'sendMessage', { chat_id: to, text, business_connection_id: connId }).catch(e => ({ ok: false, description: e.message }));
  if (res?.ok) {
    await sb.from('messages').insert({
      conversation_id: conv.id, business_id: business.id, direction: 'outbound', content: text,
      content_type: 'text', status: 'sent', is_ai_generated: false, telegram_chat_id: to, sent_at: new Date().toISOString(),
    });
    await sb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);
    try {
      const { learnFromOwnerReply } = await import('./replyEngine');
      await learnFromOwnerReply(business, conv.id, text, AGENT_TOKEN());
    } catch { /* learning is best-effort */ }
  }
  await say(token, { chat_id: chatId, text: relaySentText(relay.name, !!res?.ok, res?.description), ...MD });
  return true;
}

/** Today's Secretary numbers for one owner. */
export async function secretaryDayStats(business, now = Date.now()) {
  const sb = supabase();
  const dayStart = new Date(Date.parse(`${addisDate(now)}T00:00:00+03:00`)).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const { data: convs } = await sb.from('conversations')
    .select('id, metadata, last_message_at, customers(name, telegram_id, telegram_username)')
    .eq('business_id', business.id).gte('last_message_at', weekAgo)
    .not('metadata->contact_profile', 'is', null)
    .order('last_message_at', { ascending: false }).limit(60);
  const list = (convs || []).filter(c => !c.metadata?.contact_profile?.spam);
  if (!list.length) return { answered: 0, waiting: [], unsure: 0 };
  const { data: msgs } = await sb.from('messages')
    .select('conversation_id, direction, content, is_ai_generated, owner_edited, created_at')
    .in('conversation_id', list.map(c => c.id)).gte('created_at', weekAgo)
    .order('created_at', { ascending: true }).limit(3000);
  const byConv = new Map();
  for (const m of msgs || []) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  let answered = 0;
  const waiting = [];
  for (const c of list) {
    const h = byConv.get(c.id) || [];
    if (h.some(m => m.direction === 'outbound' && m.is_ai_generated && m.created_at >= dayStart)) answered += 1;
    const open = openPromises(h, { now, maxAgeDays: 3, max: 1 });
    if (open.length) waiting.push({ conversationId: c.id, name: nameOf(c, c.metadata?.contact_profile), asked: open[0].asked });
  }
  const { loadUnsure } = await import('./whoIsWhoRun');
  const { total: unsure } = await loadUnsure(business).catch(() => ({ total: 0 }));
  return { answered, waiting: waiting.slice(0, 5), unsure };
}

export async function sendSecretaryRecap({ token, business, chatId }) {
  const stats = await secretaryDayStats(business);
  const text = recapText(stats, { ownerFirst: String(business.owner_name || '').trim().split(/\s+/)[0] });
  if (!text) return { sent: false, reason: 'quiet_day', stats };
  const r = await say(token, { chat_id: chatId, text, reply_markup: recapKeyboard(stats), ...MD });
  return { sent: !!r?.ok, stats };
}
