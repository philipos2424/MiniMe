/**
 * Bot side of paying for Pro in chat (see lib/upgradeChat.mjs).
 */
import { supabase } from './db';
import { tg, tgDownloadFile } from './telegramApi';
import { getSettings } from './platformSettings';
import { sendMarkdownSafe } from './tgEscape.mjs';
import {
  planKeyboard, methodKeyboard, payInstructions, extractBankRef, activeUpgrade, resultText, refCode,
} from '../upgradeChat.mjs';
import { upgradeText } from '../upgradeOffer.mjs';

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || '').trim();

async function accounts() {
  const s = await getSettings([
    'payment.telebirr.phone', 'payment.telebirr.name',
    'payment.bank.name', 'payment.bank.account', 'payment.bank.holder',
  ]);
  return {
    telebirr: { phone: s['payment.telebirr.phone'], name: s['payment.telebirr.name'] },
    bank: { bankName: s['payment.bank.name'], account: s['payment.bank.account'], name: s['payment.bank.holder'] },
  };
}

async function savePrefs(business, patch) {
  const sb = supabase();
  const { data } = await sb.from('businesses').select('notification_prefs').eq('id', business.id).single();
  const prefs = { ...(data?.notification_prefs || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete prefs[k]; else prefs[k] = v; }
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', business.id);
  business.notification_prefs = prefs;
}

const send = (token, body) => sendMarkdownSafe(b => tg(token, 'sendMessage', b), { parse_mode: 'Markdown', disable_web_page_preview: true, ...body });

export async function sendUpgradeOffer({ token, business, chatId }) {
  return send(token, { chat_id: chatId, text: upgradeText(business), reply_markup: planKeyboard(appUrl()) });
}

/** upg_* buttons. Caller has checked the tapper is the owner. */
export async function handleUpgradeCallback({ token, business, chatId, msgId, data, answer }) {
  if (!data?.startsWith('upg_')) return false;
  const edit = (text, reply_markup) => tg(token, 'editMessageText', { chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown', reply_markup }).catch(() => null);

  if (data === 'upg_back') { await answer(''); await edit(upgradeText(business), planKeyboard(appUrl())); return true; }

  const plan = data.match(/^upg_plan_(pro_\w+)$/);
  if (plan) {
    const acc = await accounts();
    await answer('');
    await edit('How would you like to pay?', methodKeyboard(plan[1], { telebirr: !!acc.telebirr.phone, bank: !!acc.bank.account }));
    return true;
  }

  const pay = data.match(/^upg_pay_(pro_\w+)_(telebirr|bank)$/);
  if (pay) {
    const [, planKey, method] = pay;
    const text = payInstructions({ planKey, method, accounts: await accounts(), businessId: business.id });
    if (!text) { await answer('That payment method isn\'t available yet'); return true; }
    const txRef = `sub-${method.slice(0, 4)}-${business.id.slice(0, 8)}-${Date.now()}`;
    await supabase().from('businesses').update({
      payment_ref: txRef,
      payment_method: method === 'telebirr' ? 'telebirr' : 'bank_transfer',
      payment_notes: `Pending in-chat ${method} payment for ${planKey} — ${refCode(business.id)}`,
    }).eq('id', business.id);
    await savePrefs(business, { awaiting_sub_proof: { txRef, plan: planKey, method, at: new Date().toISOString() } });
    await answer('');
    await edit(text, { inline_keyboard: [[{ text: '✖ Cancel', callback_data: 'upg_cancel' }]] });
    return true;
  }

  if (data === 'upg_cancel') {
    await savePrefs(business, { awaiting_sub_proof: null });
    await answer('Cancelled');
    await edit('Payment cancelled. Send /upgrade any time.', { inline_keyboard: [] });
    return true;
  }
  await answer('');
  return true;
}

/**
 * The owner's screenshot / transaction number while an in-chat payment is
 * open. Returns true when it handled the message.
 */
export async function handleUpgradeProof({ token, business, chatId, msg }) {
  const pending = activeUpgrade(business.notification_prefs);
  if (!pending) return false;
  if (msg.text?.startsWith('/')) return false;

  const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id
    : (msg.document && /^image\//.test(msg.document.mime_type || '') ? msg.document.file_id : null);
  const ref = extractBankRef(msg.caption || msg.text || '');

  // Plain chat that isn't part of the payment goes on to the agent as normal.
  if (!photo && !ref) return false;

  const next = { ...pending, ...(photo ? { photoId: photo } : {}), ...(ref ? { bankRef: ref } : {}) };
  if (!next.photoId) {
    await savePrefs(business, { awaiting_sub_proof: next });
    await send(token, { chat_id: chatId, text: `Got the transaction number \`${ref}\`. Now send the screenshot of the payment.` });
    return true;
  }
  if (!next.bankRef) {
    await savePrefs(business, { awaiting_sub_proof: next });
    await send(token, { chat_id: chatId, text: 'Got the screenshot 👍 What is the *transaction number*? It\'s in your Telebirr SMS or CBE SMS (letters and numbers, e.g. CH12AB34CD).' });
    return true;
  }

  tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const buf = await tgDownloadFile(token, next.photoId);
  if (!buf) {
    await savePrefs(business, { awaiting_sub_proof: { ...next, photoId: null } });
    await send(token, { chat_id: chatId, text: '⚠️ I couldn\'t download that screenshot. Please send it again.' });
    return true;
  }
  const { submitSubscriptionProof } = await import('./subscriptionProof');
  const { status, body } = await submitSubscriptionProof({
    business: { ...business, payment_ref: pending.txRef },
    buf, mime: 'image/jpeg', txRef: pending.txRef,
    method: pending.method === 'telebirr' ? 'telebirr' : 'bank',
    plan: pending.plan, bankRef: next.bankRef,
  });
  // A wrong or reused number can be fixed by sending another; anything else closes the flow.
  const keepOpen = status >= 400 && status < 500;
  await savePrefs(business, { awaiting_sub_proof: keepOpen ? { ...next, bankRef: null } : null });
  const text = resultText(status, body);
  if (text) await send(token, { chat_id: chatId, text: keepOpen ? `${text}\n\nSend the correct transaction number to try again.` : text });
  return true;
}
