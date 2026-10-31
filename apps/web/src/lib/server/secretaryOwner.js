/**
 * Owner controls for Secretary: who a rule is for, and personalities.
 * (Prompt side lives in lib/secretaryBrain.mjs.)
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { sendMarkdownSafe } from './tgEscape.mjs';
import { PERSONAS, normalizeAudience, personaFor } from '../secretaryBrain.mjs';

const safeLike = (s) => String(s || '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 60);

/** A person the owner named: a saved family/friend, else a customer. */
export async function resolvePerson(business, who) {
  const q = String(who || '').replace(/^@/, '').trim();
  if (!q) return null;
  const lc = q.toLowerCase();
  for (const c of business.notification_prefs?.personal_contacts || []) {
    const names = [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])].filter(Boolean).map(x => String(x).toLowerCase());
    if (names.some(n => n === lc || n.split(' ')[0] === lc)) return { name: c.name || q, tg: c.telegram_id ? String(c.telegram_id) : null };
  }
  const { data } = await supabase().from('customers').select('name, telegram_id, telegram_username')
    .eq('business_id', business.id)
    .or(`name.ilike.%${safeLike(q)}%,telegram_username.ilike.%${safeLike(q)}%`)
    .order('last_active_at', { ascending: false, nullsFirst: false }).limit(1);
  const c = data?.[0];
  return c ? { name: c.name || q, tg: c.telegram_id ? String(c.telegram_id) : null } : { name: q, tg: null };
}

/** manage_rule scope: who the rule is for. */
export async function ruleScope(business, { audience, person } = {}) {
  if (person && String(person).trim()) {
    const p = await resolvePerson(business, person);
    return { person_name: p?.name || String(person).trim(), person_tg: p?.tg || null };
  }
  return { audience: normalizeAudience(audience) };
}

async function savePersonas(business, mutate) {
  const sb = supabase();
  const { data } = await sb.from('businesses').select('notification_prefs').eq('id', business.id).single();
  const prefs = { ...(data?.notification_prefs || {}) };
  const sp = { ...(prefs.secretary_personas || {}) };
  mutate(sp);
  prefs.secretary_personas = sp;
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', business.id);
  business.notification_prefs = prefs;
  return sp;
}

/** set_personality tool. style: like_me | professional | friendly | warm | playful | brief */
export async function setPersonality(business, { audience, style, person } = {}) {
  const key = String(style || '').toLowerCase().replace(/[\s&-]+/g, '_');
  const styleKey = PERSONAS[key] ? key : Object.keys(PERSONAS).find(k => PERSONAS[k].label.toLowerCase().startsWith(String(style || '').toLowerCase().slice(0, 4)));
  if (!styleKey) return `Which style? ${Object.values(PERSONAS).map(p => p.label).join(', ')}.`;
  const p = PERSONAS[styleKey];
  if (person && String(person).trim()) {
    const who = await resolvePerson(business, person);
    if (!who?.tg) return `I don't have a Telegram chat with *${person}* yet, so I can't set a style just for them. Set it for their group instead (customers, family or friends).`;
    await savePersonas(business, sp => { sp.people = { ...(sp.people || {}), [who.tg]: styleKey }; });
    return `${p.emoji} With *${who.name}* I'll be *${p.label}*.`;
  }
  const aud = normalizeAudience(audience);
  const targets = aud === 'everyone' ? ['customers', 'family', 'friends'] : [aud];
  await savePersonas(business, sp => { for (const t of targets) sp[t] = styleKey; });
  return `${p.emoji} With ${aud === 'everyone' ? 'everyone' : `your *${aud}*`} I'll be *${p.label}*: ${p.text}`;
}

const AUD_LABEL = { customers: '🛒 Customers', family: '👨‍👩‍👧 Family', friends: '👫 Friends' };

export function personalityMenu(business) {
  const prefs = business.notification_prefs || {};
  const lines = ['🎭 *How Secretary sounds*', '', 'Pick a style for each group. "Like me" copies how you write to each person.', ''];
  for (const aud of ['customers', 'family', 'friends']) {
    const k = personaFor(prefs, { audience: aud });
    lines.push(`${AUD_LABEL[aud]}: *${PERSONAS[k].emoji} ${PERSONAS[k].label}*`);
  }
  const people = Object.keys(prefs.secretary_personas?.people || {}).length;
  if (people) lines.push('', `_Plus ${people} person-specific style${people === 1 ? '' : 's'}._`);
  lines.push('', '_You can also just tell me: "be playful with my friends" or "be professional with Abebe"._');
  return {
    text: lines.join('\n'),
    keyboard: ['customers', 'family', 'friends'].map(aud => [{ text: `Change ${AUD_LABEL[aud]}`, callback_data: `sp_pick_${aud}` }]),
  };
}

/** sp_* buttons. Caller checks the tapper is the owner. */
export async function handlePersonaCallback({ token, business, chatId, msgId, data, answer }) {
  if (!data?.startsWith('sp_')) return false;
  const edit = (text, kb) => sendMarkdownSafe(b => tg(token, 'editMessageText', b), { chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb || [] } });
  const pick = data.match(/^sp_pick_(customers|family|friends)$/);
  if (pick) {
    await answer('');
    const rows = Object.entries(PERSONAS).map(([k, p]) => [{ text: `${p.emoji} ${p.label}`, callback_data: `sp_set_${pick[1]}_${k}` }]);
    rows.push([{ text: '← Back', callback_data: 'sp_menu' }]);
    await edit(`How should I sound with your *${pick[1]}*?\n\n${Object.values(PERSONAS).map(p => `${p.emoji} *${p.label}* — ${p.text}`).join('\n')}`, rows);
    return true;
  }
  const set = data.match(/^sp_set_(customers|family|friends)_(\w+)$/);
  if (set) {
    await setPersonality(business, { audience: set[1], style: set[2] });
    await answer('Saved');
    const m = personalityMenu(business);
    await edit(m.text, m.keyboard);
    return true;
  }
  if (data === 'sp_menu') { await answer(''); const m = personalityMenu(business); await edit(m.text, m.keyboard); return true; }
  await answer('');
  return true;
}
