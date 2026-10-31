/**
 * The setup guide's I/O side: reads progress, stores state, sends each step,
 * and takes the owner's next message as the answer. Logic and copy live in
 * setupGuide.mjs (tested). Entry points used by replyEngine.js:
 *   sendSetupGuide, handleSetupCallback, handleSetupAnswer, setupIncomplete
 */
import { supabase } from './db';
import { sendMarkdownSafe } from './tgEscape.mjs';
import { tg } from './telegramApi';
import {
  computeProgress, guideText, guideKeyboard, stepStart, basicsQuestion, nextBasics, nextOpenBasics,
  activeAwaiting, normalizeEtPhone, normalizeCbeAccount, cancelsAwaiting, mdEscape,
} from './setupGuide.mjs';
import { priceIn, validateNewProduct } from './ownerTeach.mjs';
import { enabledMethods } from './customerPayments.mjs';
import { customerShopLink } from '../shopLink';

const MD = { parse_mode: 'Markdown', disable_web_page_preview: true };

/**
 * sendMessage that never silently drops a guide step: if Telegram can't parse
 * the Markdown, send it again as plain text.
 */
async function say(token, body) {
  // Must call tg(), never itself: a bulk rename once made it recurse,
  // and /setup crashed with "Maximum call stack size exceeded".
  return sendMarkdownSafe(b => tg(token, 'sendMessage', b), body);
}

async function basicsFacts(business) {
  const { data } = await supabase().from('businesses').select('business_hours, location, notification_prefs').eq('id', business.id).maybeSingle();
  return { facts: { hours: data?.business_hours, location: data?.location }, setup: data?.notification_prefs?.setup || {} };
}

async function freshPrefs(businessId) {
  const { data } = await supabase().from('businesses').select('notification_prefs').eq('id', businessId).maybeSingle();
  return data?.notification_prefs || {};
}

/** Merge into notification_prefs.setup from a FRESH read (webhooks write prefs all day). */
async function saveSetup(business, patch) {
  const prefs = await freshPrefs(business.id);
  const setup = { ...(prefs.setup || {}), ...patch };
  const next = { ...prefs, setup };
  await supabase().from('businesses').update({ notification_prefs: next }).eq('id', business.id);
  business.notification_prefs = next;
  return setup;
}

async function addSkip(business, key) {
  const prefs = await freshPrefs(business.id);
  const skipped = [...new Set([...(prefs.setup?.skipped || []), key])];
  return saveSetup(business, { skipped, awaiting: null });
}

async function progressFor(business) {
  const sb = supabase();
  const [{ count }, { data: biz }] = await Promise.all([
    sb.from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('is_active', true),
    sb.from('businesses').select('business_hours, location, notification_prefs, telegram_biz_conn_id, owner_instructions').eq('id', business.id).maybeSingle(),
  ]);
  const prefs = biz?.notification_prefs || business.notification_prefs || {};
  const m = enabledMethods(prefs.payments || {});
  const ownRules = (Array.isArray(biz?.owner_instructions) ? biz.owner_instructions : [])
    .filter(r => r && r.rule && r.source !== 'faq' && !['category_template', 'template', 'default'].includes(r.source));
  return computeProgress(
    {
      productCount: count || 0, hasPayment: m.telebirr || m.cbe, hours: biz?.business_hours, location: biz?.location,
      secretaryConnected: !!biz?.telegram_biz_conn_id,
      peopleCount: (prefs.personal_contacts || []).length,
      styleSet: Object.keys(prefs.secretary_personas || {}).length > 0,
      ownRuleCount: ownRules.length,
    },
    prefs.setup || {},
  );
}

/** True while the guide still has steps to do and the owner hasn't hidden it. */
export async function setupIncomplete(business) {
  if (business.notification_prefs?.setup?.dismissed) return false;
  try { return !(await progressFor(business)).complete; } catch { return false; }
}

const firstName = b => String(b.owner_name || '').trim().split(/\s+/)[0] || '';

export async function sendSetupGuide(token, business, chatId) {
  const p = await progressFor(business);
  await say(token, { chat_id: chatId, text: guideText(p, { ownerFirst: firstName(business) }), reply_markup: guideKeyboard(p), ...MD });
  return p;
}

async function startStep(token, business, chatId, key) {
  if (key === 'share') return sendShare(token, business, chatId);
  if (key === 'people') {
    await say(token, { chat_id: chatId, text: stepStart('people').text, ...MD });
    const { sendWhoCard } = await import('./whoIsWhoRun');
    await sendWhoCard({ token, business, chatId });
    await say(token, { chat_id: chatId, text: 'Tap *Done* when you\'ve sorted them.', reply_markup: { inline_keyboard: [[{ text: '✅ Done', callback_data: 'setup_done_people' }]] }, ...MD });
    return;
  }
  if (key === 'style') {
    const { personalityMenu } = await import('./secretaryOwner');
    const menu = personalityMenu(business);
    await say(token, { chat_id: chatId, text: menu.text, reply_markup: { inline_keyboard: [...menu.keyboard, [{ text: '✅ Sounds good', callback_data: 'setup_done_style' }]] }, ...MD });
    return;
  }
  if (key === 'basics') {
    const { facts, setup } = await basicsFacts(business);
    const first = nextOpenBasics(facts, setup, 'hours');
    if (!first) { await saveSetup(business, { delivery_done: true }); return sendSetupGuide(token, business, chatId); }
    return askBasics(token, business, chatId, first);
  }
  let exampleProduct = '';
  if (key === 'preview') {
    const { data } = await supabase().from('products').select('name').eq('business_id', business.id).eq('is_active', true).limit(1);
    exampleProduct = data?.[0]?.name || '';
  }
  const s = stepStart(key, { exampleProduct, businessName: business.name, botUsername: (process.env.NEXT_PUBLIC_BOT_USERNAME || 'MiniMeAgentBot').replace(/^@/, '') });
  if (!s) return;
  await saveSetup(business, { awaiting: s.awaiting, awaiting_at: s.awaiting ? new Date().toISOString() : null });
  await say(token, { chat_id: chatId, text: s.text, ...(s.keyboard ? { reply_markup: s.keyboard } : {}), ...MD });
}

async function sendShare(token, business, chatId) {
  const link = customerShopLink(business, process.env.WEB_URL || process.env.NEXT_PUBLIC_APP_URL);
  if (!link) {
    await say(token, { chat_id: chatId, text: "I couldn't find your shop link yet — open MiniMe → Profile to get it.", ...MD });
    return;
  }
  const shareText = `Message ${business.name || 'us'} on Telegram — ask anything, see prices, order:`;
  const s = stepStart('share', { businessName: business.name });
  await say(token, {
    chat_id: chatId,
    text: `${s.text}\n\n🔗 ${mdEscape(link)}`,
    reply_markup: { inline_keyboard: [
      [{ text: '📤 Share it now', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}` }],
      [{ text: '✅ Done', callback_data: 'setup_done_share' }],
    ] },
    ...MD,
  });
}

/**
 * Buttons: setup_open, setup_hide, setup_go_<step>, setup_skip_<step|hours|location|delivery>,
 * setup_done_<products|share>, setup_pay_<telebirr|cbe>. setup_run_preview is
 * handled in replyEngine (it needs draftReply). Returns true when handled.
 */
export async function handleSetupCallback({ token, business, chatId, data, answer }) {
  if (!data.startsWith('setup_')) return false;
  const rest = data.slice('setup_'.length);
  if (rest === 'open') { await answer('📋'); await sendSetupGuide(token, business, chatId); return true; }
  if (rest === 'hide') {
    await saveSetup(business, { dismissed: true, awaiting: null });
    await answer('OK');
    await say(token, { chat_id: chatId, text: 'No problem. Type /setup whenever you want to continue.' });
    return true;
  }
  if (rest.startsWith('go_')) { await answer('▶️'); await saveSetup(business, { dismissed: false }); await startStep(token, business, chatId, rest.slice(3)); return true; }
  if (rest.startsWith('pay_')) {
    const kind = rest.slice(4);
    await saveSetup(business, { awaiting: kind, awaiting_at: new Date().toISOString() });
    await answer('💳');
    await say(token, {
      chat_id: chatId,
      text: kind === 'telebirr'
        ? `📱 *Send your Telebirr number* — the one customers should pay to.\n\nFor example: _0911 234 567_`
        : `🏦 *Send your CBE account number* (13 digits).\n\nFor example: _1000123456789_`,
      reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: 'setup_skip_payments' }]] },
      ...MD,
    });
    return true;
  }
  if (rest.startsWith('skip_')) {
    const key = rest.slice(5);
    await addSkip(business, key);
    await answer('⏭️ Skipped');
    // Inside the basics step a skip moves to the next basics question.
    if (['hours', 'location', 'delivery'].includes(key) && nextBasics(key)) {
      const { facts, setup } = await basicsFacts(business);
      const nb = nextOpenBasics(facts, setup, nextBasics(key));
      if (nb) return askBasics(token, business, chatId, nb).then(() => true);
    }
    await sendSetupGuide(token, business, chatId);
    return true;
  }
  if (rest.startsWith('track_')) {
    const track = rest.slice(6) === 'secretary' ? 'secretary' : 'shop';
    await saveSetup(business, { track, dismissed: false, awaiting: null });
    await answer(track === 'secretary' ? '📱' : '🛍️');
    await sendSetupGuide(token, business, chatId);
    return true;
  }
  if (rest === 'check_connect') {
    const { data } = await supabase().from('businesses').select('telegram_biz_conn_id').eq('id', business.id).maybeSingle();
    if (data?.telegram_biz_conn_id) { await answer('✅ Connected'); await sendSetupGuide(token, business, chatId); }
    else {
      await answer('Not connected yet');
      await say(token, { chat_id: chatId, text: "I can't see the connection yet. Check *Settings → Telegram Business → Chatbots* lists MiniMe with *Reply to messages* on, then tap again.", reply_markup: { inline_keyboard: [[{ text: "✅ I've connected it", callback_data: 'setup_check_connect' }], [{ text: '⏭️ Skip for now', callback_data: 'setup_skip_connect' }]] }, ...MD });
    }
    return true;
  }
  if (rest === 'done_people') {
    // Nobody saved is fine — some owners have no one to mark yet.
    const prefs = await freshPrefs(business.id);
    if (!(prefs.personal_contacts || []).length) await addSkip(business, 'people');
    await answer('✅'); await sendSetupGuide(token, business, chatId); return true;
  }
  if (rest === 'done_style') { await saveSetup(business, { style_done: true, awaiting: null }); await answer('✅'); await sendSetupGuide(token, business, chatId); return true; }
  if (rest === 'done_products') { await saveSetup(business, { awaiting: null }); await answer('✅'); await sendSetupGuide(token, business, chatId); return true; }
  if (rest === 'done_share') { await saveSetup(business, { shared: true, awaiting: null }); await answer('🎉'); await sendSetupGuide(token, business, chatId); return true; }
  return false;
}

async function askBasics(token, business, chatId, which) {
  const q = basicsQuestion(which);
  await saveSetup(business, { awaiting: q.awaiting, awaiting_at: new Date().toISOString() });
  await say(token, { chat_id: chatId, text: q.text, reply_markup: q.keyboard, ...MD });
}

/**
 * The owner's message while a step is waiting for an answer. Returns true when
 * it was taken as the answer (the caller stops), false to let it through.
 */
export async function handleSetupAnswer({ token, business, chatId, msg }) {
  const setup = business.notification_prefs?.setup;
  const awaiting = activeAwaiting(setup);
  if (!awaiting) return false;
  const text = String(msg.text || msg.caption || '').trim();

  if (msg.text && cancelsAwaiting(msg.text)) {
    await saveSetup(business, { awaiting: null });
    return false; // let the command run
  }

  // ── Products: photo (caption or Vision) or typed "name price" ──
  if (awaiting === 'product') {
    if (msg.photo?.length) {
      const { describeOwnerPhoto } = await import('./teachFromMedia');
      const { ingestPostToProducts } = await import('./channelIngest');
      const d = await describeOwnerPhoto(token, msg);
      const ingest = await ingestPostToProducts({ msg, business, token, visionText: d.ok ? d.description : '' }).catch(() => ({ products: [] }));
      if (!ingest.products.length) {
        await say(token, { chat_id: chatId, text: "I couldn't read a name and price from that photo. Send it again with a caption like _Red dress 1500 birr_.", ...MD });
        return true;
      }
      await saveSetup(business, { awaiting_at: new Date().toISOString() });
      const names = ingest.products.map(p => `*${p.name}*${p.price != null ? ` — ${Number(p.price).toLocaleString()} ETB` : ''}`).join(', ');
      await say(token, { chat_id: chatId, text: `✅ Added ${names} with the photo.\n\nSend the next one, or tap *Done*.`, reply_markup: { inline_keyboard: [[{ text: '✅ Done adding', callback_data: 'setup_done_products' }]] }, ...MD });
      return true;
    }
    if (!msg.text) return false;
    const price = priceIn(text) ?? (Number((text.match(/(\d[\d,]*(?:\.\d+)?)\s*$/) || [])[1]?.replace(/,/g, '')) || null);
    const name = text.replace(/(\d[\d,]*(?:\.\d+)?)\s*(etb|birr|br|ብር)?\s*$/i, '').replace(/[-–:,]+\s*$/, '').trim();
    const v = validateNewProduct({ name, price });
    if (!v.ok) {
      await say(token, { chat_id: chatId, text: `${v.error}\n\nType it like _Injera 45 birr_.`, ...MD });
      return true;
    }
    const { addProductFromAgent } = await import('./ownerCommands');
    const out = await addProductFromAgent(business, v.product);
    await saveSetup(business, { awaiting_at: new Date().toISOString() });
    await say(token, {
      chat_id: chatId,
      text: `${out.split('\n')[0]}\n\nSend the next one, or tap *Done*.`,
      reply_markup: { inline_keyboard: [[{ text: '✅ Done adding', callback_data: 'setup_done_products' }]] },
      ...MD,
    });
    return true;
  }

  if (!msg.text) return false;

  // ── Secretary: first rule ──
  if (awaiting === 'rule') {
    if (text.length < 4) return true;
    const { saveOwnerInstruction } = await import('./advisor');
    await saveOwnerInstruction(business.id, text.slice(0, 300));
    await saveSetup(business, { awaiting: null });
    await say(token, { chat_id: chatId, text: `✅ Rule saved — I'll ${text.charAt(0).toLowerCase() + text.slice(1)}.\n\n_Add more any time by just telling me, e.g. "never talk business with my family"._`, ...MD });
    await sendSetupGuide(token, business, chatId);
    return true;
  }

  // ── Payments ──
  if (awaiting === 'telebirr' || awaiting === 'cbe') {
    const value = awaiting === 'telebirr' ? normalizeEtPhone(text) : normalizeCbeAccount(text);
    if (!value) {
      await say(token, {
        chat_id: chatId,
        text: awaiting === 'telebirr' ? "That doesn't look like a Telebirr number. Send it like _0911 234 567_." : "A CBE account number has 13 digits, like _1000123456789_. Try again?",
        ...MD,
      });
      return true;
    }
    const prefs = await freshPrefs(business.id);
    const payments = { ...(prefs.payments || {}) };
    if (awaiting === 'telebirr') Object.assign(payments, { telebirr_manual: true, telebirr_phone: value });
    else Object.assign(payments, { cbe_manual: true, cbe_account: value });
    const next = { ...prefs, payments, setup: { ...(prefs.setup || {}), awaiting: null } };
    await supabase().from('businesses').update({ notification_prefs: next }).eq('id', business.id);
    business.notification_prefs = next;
    await say(token, {
      chat_id: chatId,
      text: `✅ Saved — customers will be asked to pay to ${awaiting === 'telebirr' ? `Telebirr *${value}*` : `CBE *${value}*`}, with an order reference. When they tap "I've paid", you'll get Confirm / Not yet here.\n\n_Change it any time in MiniMe → Settings → Payments._`,
      ...MD,
    });
    await sendSetupGuide(token, business, chatId);
    return true;
  }

  // ── The basics ──
  if (['hours', 'location', 'delivery'].includes(awaiting)) {
    if (text.length < 2) return true;
    const { saveBusinessInfo } = await import('./ownerCommands');
    if (awaiting === 'hours') {
      await supabase().from('businesses').update({ business_hours: text.slice(0, 200) }).eq('id', business.id);
      business.business_hours = text.slice(0, 200);
      await saveBusinessInfo(business, `Opening hours: ${text}`);
    } else if (awaiting === 'location') {
      await supabase().from('businesses').update({ location: text.slice(0, 200) }).eq('id', business.id);
      business.location = text.slice(0, 200);
      await saveBusinessInfo(business, `Location: ${text}`);
    } else {
      await saveBusinessInfo(business, `Delivery: ${text}`);
      await saveSetup(business, { delivery_done: true });
    }
    const { facts, setup } = await basicsFacts(business);
    const nb = nextBasics(awaiting) ? nextOpenBasics(facts, setup, nextBasics(awaiting)) : null;
    await say(token, { chat_id: chatId, text: '✅ Got it.' });
    if (nb) await askBasics(token, business, chatId, nb);
    else { await saveSetup(business, { awaiting: null }); await sendSetupGuide(token, business, chatId); }
    return true;
  }
  return false;
}

/** After the preview step ran (replyEngine), record it and show the guide. */
export async function markPreviewed(token, business, chatId) {
  await saveSetup(business, { previewed: true, awaiting: null });
  await sendSetupGuide(token, business, chatId);
}
