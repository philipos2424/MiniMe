/**
 * One-message setup, the I/O side (logic and copy in setupIntake.mjs).
 * Entry points: askIntake, runIntake, startIntakeFix. Called from setupGuideRun.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { sendMarkdownSafe } from './tgEscape.mjs';
import { loggedCompletion } from './openai-wrapper';
import { MODEL_MINI } from './constants';
import { enabledMethods } from './customerPayments.mjs';
import {
  INTAKE_SYSTEM, normalizeIntake, intakeUseful, intakeQuestion, intakeKeyboard,
  assemblyLines, assemblyText, intakeSummary, intakeSummaryKeyboard, fixPrompt,
} from './setupIntake.mjs';

const MD = { parse_mode: 'Markdown', disable_web_page_preview: true };
const say = (token, body) => sendMarkdownSafe(b => tg(token, 'sendMessage', b), body);
const firstName = b => String(b.owner_name || '').trim().split(/\s+/)[0] || '';
const PLACEHOLDER_NAME = /^(my (shop|business)|shop|business|new (shop|business)|untitled|)$/i;

async function freshPrefs(id) {
  const { data } = await supabase().from('businesses').select('notification_prefs').eq('id', id).maybeSingle();
  return data?.notification_prefs || {};
}

async function patchPrefs(business, fn) {
  const prefs = await freshPrefs(business.id);
  const next = fn(prefs);
  await supabase().from('businesses').update({ notification_prefs: next }).eq('id', business.id);
  business.notification_prefs = next;
  return next;
}

const patchSetup = (business, patch) => patchPrefs(business, p => ({ ...p, setup: { ...(p.setup || {}), ...patch } }));

/** The one open question. */
export async function askIntake(token, business, chatId) {
  await patchSetup(business, { awaiting: 'intake', awaiting_at: new Date().toISOString(), dismissed: false });
  await say(token, { chat_id: chatId, text: intakeQuestion(firstName(business)), reply_markup: intakeKeyboard(), ...MD });
}

/** "✏️ Fix something" on the summary card. */
export async function startIntakeFix(token, business, chatId) {
  await patchSetup(business, { awaiting: 'intake', awaiting_at: new Date().toISOString(), intake_fix: true });
  await say(token, { chat_id: chatId, text: '✏️ *What should I change or add?*\n\nJust tell me, e.g. _"sandals are 950"_, _"we also sell bags 1200"_, _"closed on Sunday"_.', ...MD });
}

export async function extractIntake(business, text, { previous = null, fix = false } = {}) {
  const resp = await loggedCompletion({
    route: 'setup_intake',
    business_id: business.id,
    bypass_credit_check: true,
    model: MODEL_MINI,
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    temperature: 0.1,
    messages: [
      { role: 'system', content: INTAKE_SYSTEM },
      { role: 'user', content: fix ? fixPrompt(text, previous) : `Owner: ${text}` },
    ],
  });
  return normalizeIntake(resp?.choices?.[0]?.message?.content || '');
}

/** Save each part; `onStep` runs after each assembly line is done (for the live message). */
export async function applyIntake(business, i, { onStep = async () => {} } = {}) {
  const sb = supabase();
  const { addProductFromAgent, saveBusinessInfo } = await import('./ownerCommands');
  const step = async (fn) => { try { await fn(); } catch (e) { console.warn('[intake]', e.message); } await onStep(); };

  // Name / category / description: fill blanks only, never overwrite the owner's.
  const { data: cur } = await sb.from('businesses').select('name, category, description').eq('id', business.id).maybeSingle();
  const basics = {};
  if (i.business_name && PLACEHOLDER_NAME.test(String(cur?.name || '').trim())) basics.name = i.business_name;
  if (i.category && (!cur?.category || cur.category === 'other')) basics.category = i.category;
  if (i.about && !cur?.description) basics.description = i.about;
  if (Object.keys(basics).length) { await sb.from('businesses').update(basics).eq('id', business.id); Object.assign(business, basics); }

  if (i.products.length) await step(async () => { for (const p of i.products) await addProductFromAgent(business, p); });
  if (i.location) await step(async () => {
    await sb.from('businesses').update({ location: i.location }).eq('id', business.id);
    business.location = i.location;
  });
  if (i.hours) await step(async () => {
    await sb.from('businesses').update({ business_hours: i.hours }).eq('id', business.id);
    business.business_hours = i.hours;
  });
  if (i.delivery) await step(async () => {
    await saveBusinessInfo(business, `Delivery: ${i.delivery}`);
    await patchSetup(business, { delivery_done: true });
  });
  if (i.telebirr || i.cbe) await step(() => patchPrefs(business, p => {
    const payments = { ...(p.payments || {}) };
    if (i.telebirr) Object.assign(payments, { telebirr_manual: true, telebirr_phone: i.telebirr });
    if (i.cbe) Object.assign(payments, { cbe_manual: true, cbe_account: i.cbe });
    return { ...p, payments };
  }));
  // Location and hours also go in as facts (one call), with the extras customers ask.
  const factText = [i.location && `Location: ${i.location}`, i.hours && `Opening hours: ${i.hours}`, ...i.facts].filter(Boolean).join('\n');
  if (factText) {
    const run = async () => { await saveBusinessInfo(business, factText); };
    if (i.facts.length) await step(run); else await run().catch(e => console.warn('[intake] facts', e.message));
  }
}

async function editOrSend(token, chatId, messageId, text, extra = {}) {
  if (messageId) {
    const r = await tg(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, ...MD, ...extra }).catch(() => null);
    if (r?.ok || /not modified/i.test(r?.description || '')) return messageId;
  }
  const r = await say(token, { chat_id: chatId, text, ...MD, ...extra });
  return r?.result?.message_id || null;
}

function merged(prev, i) {
  if (!prev) return i;
  const byName = new Map((prev.products || []).map(p => [p.name.toLowerCase(), p]));
  for (const p of i.products) byName.set(p.name.toLowerCase(), p);
  const pick = k => i[k] ?? prev[k] ?? null;
  return {
    ...i,
    about: pick('about'), hours: pick('hours'), location: pick('location'), delivery: pick('delivery'),
    telebirr: pick('telebirr'), cbe: pick('cbe'),
    products: [...byName.values()],
    unpriced: (prev.unpriced || []).filter(n => !byName.has(n.toLowerCase())).concat(i.unpriced).slice(0, 10),
    facts: i.facts,
  };
}

/** The owner's one message (or photo) → a set-up MiniMe and a summary card. */
export async function runIntake({ token, business, chatId, msg }) {
  const setup = business.notification_prefs?.setup || {};
  const fix = !!setup.intake_fix;
  await tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  let text = String(msg.text || msg.caption || '').trim();
  if (msg.photo?.length) {
    const { describeOwnerPhoto } = await import('./teachFromMedia');
    const d = await describeOwnerPhoto(token, msg).catch(() => ({ ok: false }));
    if (d.ok) text = `${text ? `${text}\n\n` : ''}[Photo of their price list / menu / products, described]: ${d.description}`;
    else if (!text) {
      await say(token, { chat_id: chatId, text: "I couldn't read that photo. Send a clearer one, or just type what you sell and the prices.", ...MD });
      return true;
    }
  }
  if (text.length < 3) return true;

  let i;
  try { i = await extractIntake(business, text, { previous: setup.intake || null, fix }); }
  catch (e) {
    console.warn('[intake] extract', e.message);
    await say(token, { chat_id: chatId, text: "⚠️ I couldn't process that just now. Send it again in a moment, or set up step by step.", reply_markup: { inline_keyboard: [[{ text: '📋 Step by step', callback_data: 'setup_track_shop' }]] }, ...MD });
    return true;
  }

  if (!intakeUseful(i)) {
    await patchSetup(business, { awaiting_at: new Date().toISOString() });
    await say(token, {
      chat_id: chatId,
      text: "I didn't catch what you sell yet. Tell me a few items with prices, like _\"Shiro 120, Tibs 350, open 8–9 in Bole\"_ — or send a photo of your price list.",
      reply_markup: intakeKeyboard(), ...MD,
    });
    return true;
  }

  if (i.track === 'secretary' && !fix) {
    await patchSetup(business, { track: 'secretary', awaiting: null, intake_done: true });
    const { sendSetupGuide } = await import('./setupGuideRun');
    await say(token, { chat_id: chatId, text: "📱 Got it — you want me to answer *your own* Telegram. Let's connect me and tell me who's who.", ...MD });
    await sendSetupGuide(token, business, chatId);
    return true;
  }

  // Live "setting up…" message, one line ticking off per saved part.
  const total = assemblyLines(i).length;
  let stage = 0;
  let mid = await editOrSend(token, chatId, null, assemblyText(i, 0));
  await applyIntake(business, i, { onStep: async () => { stage += 1; mid = await editOrSend(token, chatId, mid, assemblyText(i, Math.min(stage, total))); } });

  const all = merged(fix ? setup.intake : null, i);
  // Keep a small copy so "Fix" can correct it later.
  const compact = { ...all, products: all.products.slice(0, 40), facts: undefined };
  await patchSetup(business, { track: 'shop', awaiting: null, intake_done: true, intake_fix: false, intake: compact });

  const [{ count }, { data: biz }] = await Promise.all([
    supabase().from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('is_active', true),
    supabase().from('businesses').select('business_hours, location, notification_prefs').eq('id', business.id).maybeSingle(),
  ]);
  const m = enabledMethods(biz?.notification_prefs?.payments || {});
  const existing = { productCount: count || 0, hasPayment: !!(m.telebirr || m.cbe), location: biz?.location, hours: biz?.business_hours };
  await say(token, { chat_id: chatId, text: intakeSummary(all, existing), reply_markup: intakeSummaryKeyboard(all, existing), ...MD });
  return true;
}
