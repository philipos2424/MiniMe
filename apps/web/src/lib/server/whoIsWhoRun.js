/**
 * Bot side of "Who are these people?" (see lib/whoIsWho.mjs).
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { sendMarkdownSafe } from './tgEscape.mjs';
import { unsureContacts, whoCardText, whoKeyboard, parseWho, whoDoneText } from '../whoIsWho.mjs';

export async function loadUnsure(business, { days = 30, max = 6 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase().from('conversations')
    .select('id, metadata, last_message_at, customer_id, customers(name, telegram_id, telegram_username)')
    .eq('business_id', business.id).gte('last_message_at', since)
    .not('metadata->contact_profile', 'is', null)
    .order('last_message_at', { ascending: false }).limit(200);
  const personalIds = (business.notification_prefs?.personal_contacts || []).map(c => c.telegram_id).filter(Boolean);
  const all = unsureContacts(data || [], { personalIds, max: 1000 });
  return { list: all.slice(0, max), total: all.length };
}

export async function sendWhoCard({ token, business, chatId }) {
  const { list, total } = await loadUnsure(business);
  return sendMarkdownSafe(b => tg(token, 'sendMessage', b), {
    chat_id: chatId, text: whoCardText(list, total), parse_mode: 'Markdown',
    reply_markup: list.length ? { inline_keyboard: whoKeyboard(list) } : undefined,
  });
}

/** who_* buttons. Caller checks the tapper is the owner. */
export async function handleWhoCallback({ token, business, chatId, data, answer }) {
  if (!data?.startsWith('who_')) return false;
  if (data === 'who_noop') { await answer(''); return true; }
  if (data === 'who_list') { await answer('👥'); await sendWhoCard({ token, business, chatId }); return true; }
  const parsed = parseWho(data);
  if (!parsed) { await answer(''); return true; }
  const sb = supabase();
  const { data: conv } = await sb.from('conversations')
    .select('id, metadata, customers(name, telegram_id)')
    .eq('id', parsed.conversationId).eq('business_id', business.id).maybeSingle();
  if (!conv) { await answer('Not found'); return true; }
  const cp = conv.metadata?.contact_profile || {};
  const name = cp.name || conv.customers?.name || 'They';
  const tgId = conv.customers?.telegram_id ? String(conv.customers.telegram_id) : null;
  const relationship = parsed.relation === 'ignore' ? 'unknown' : parsed.relation;
  // owner_set: the nightly/when-thin profile refresh must not overwrite the owner's answer.
  await sb.from('conversations').update({
    metadata: { ...(conv.metadata || {}), contact_profile: { ...cp, relationship, owner_set: true, updated_at: new Date().toISOString() } },
  }).eq('id', conv.id);

  // Keep the people list / contact rules in step, so the webhook routes them right.
  if (tgId) {
    const { data: fresh } = await sb.from('businesses').select('notification_prefs').eq('id', business.id).single();
    const prefs = { ...(fresh?.notification_prefs || {}) };
    let people = Array.isArray(prefs.personal_contacts) ? [...prefs.personal_contacts] : [];
    people = people.filter(p => String(p.telegram_id) !== tgId);
    if (parsed.relation === 'family' || parsed.relation === 'friend') {
      people.push({ telegram_id: tgId, name, relation: parsed.relation, added_at: new Date().toISOString(), source: 'who_card' });
    }
    prefs.personal_contacts = people;
    const rules = { ...(prefs.contact_rules || {}) };
    if (parsed.relation === 'ignore') rules[tgId] = { rule: 'never', name, at: new Date().toISOString() };
    else if (rules[tgId]?.rule === 'never') delete rules[tgId];
    prefs.contact_rules = rules;
    await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', business.id);
    business.notification_prefs = prefs;
  }
  await answer('Saved');
  await sendMarkdownSafe(b => tg(token, 'sendMessage', b), { chat_id: chatId, text: whoDoneText(name, parsed.relation), parse_mode: 'Markdown' });
  return true;
}
