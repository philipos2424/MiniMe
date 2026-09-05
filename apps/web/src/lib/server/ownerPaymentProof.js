/**
 * Paying by sending a screenshot to the bot.
 *
 * The Mini App flow asked a merchant to: open the app, copy an account number
 * by hand, leave for Telebirr, transfer, come back, re-open the app, type a
 * 12-character transaction number, attach the screenshot. Two app switches and
 * two hand transcriptions, on a phone, either of which could be typo'd into a
 * failed verification.
 *
 * Meanwhile the thing merchants actually do — send the receipt straight into
 * their bot chat — did nothing at all: the photo fell through to the
 * team-delegation handler and then to teachFromPhoto, which cheerfully filed
 * their payment receipt as business knowledge.
 *
 * So the chat is now a payment entry point. Send the screenshot; we read the
 * transaction number off it and verify. Nothing about the DECISION is relaxed
 * to make that work — this module reads an image and calls submitPaymentProof,
 * which applies exactly the same verify-first rules as the Mini App.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { submitPaymentProof, normaliseMethod } from './paymentProof';
import { downloadTelegramPhoto, downloadTelegramFile, readPaymentScreenshot } from './paymentScreenshot';

// How long we keep waiting for the transaction number after a screenshot we
// couldn't read one from. Long enough to survive an interruption, short enough
// that a stray code-shaped message next week isn't read as an answer.
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

// What a bank transaction number can look like. Also the guard on the
// follow-up path: an owner replying "ok thanks" must not be submitted as a
// reference.
const REFERENCE_RE = /^[A-Za-z0-9-]{6,32}$/;

/** Is this shop mid-payment — told how to pay, not yet confirmed? */
export function hasPendingPayment(business) {
  return !!business?.payment_ref && business?.payment_verified !== true;
}

function pendingProof(business) {
  const p = business?.notification_prefs?.pending_payment_proof;
  if (!p?.file_id || !p.at) return null;
  if (Date.now() - new Date(p.at).getTime() > PENDING_TTL_MS) return null;
  return p;
}

async function setPendingProof(business, value) {
  const prefs = { ...(business.notification_prefs || {}) };
  if (value) prefs.pending_payment_proof = value;
  else delete prefs.pending_payment_proof;
  try {
    await supabase().from('businesses').update({ notification_prefs: prefs }).eq('id', business.id);
    business.notification_prefs = prefs; // keep the local copy in sync
  } catch (e) {
    console.warn('[owner-payment] pending state:', e.message);
  }
}

/**
 * Turn a submitPaymentProof result into something to say in the chat the
 * merchant is standing in.
 *
 * Deliberately short. The full receipt and the verdict detail are sent by the
 * platform bot from inside the payment path itself; repeating them here would
 * have the merchant read the same outcome twice in two different voices.
 */
function replyFor(body, httpStatus) {
  if (httpStatus >= 400) {
    if (body.error === 'reference_already_used') {
      return `⚠️ That transaction number has already been used for another subscription. If this is a mistake, reply here and we'll check it by hand.`;
    }
    if (body.error === 'bank_reference_required') {
      return `📄 Got the screenshot — I just need the transaction number from it. Reply with it and I'll verify the payment.`;
    }
    if (body.error?.startsWith?.('tx_ref mismatch')) {
      return `⚠️ I couldn't match this to a payment we're expecting. Open *Upgrade* in the app to start the payment again, then send the screenshot here.`;
    }
    return `⚠️ ${body.message || body.error || 'Something went wrong handling that payment.'}`;
  }
  if (body.status === 'active' || body.verified) return `🎉 *Payment confirmed* — Pro is active. Your receipt is in your chat with @MiniMeAgentBot.`;
  if (body.status === 'verifying') return `⏳ Checking that with your bank now — I'll message you the moment it clears.`;
  return `📨 Got it. We couldn't confirm it automatically${body.reason ? ` (${body.reason})` : ''}, so a human is checking — usually within 24 hours. Please don't pay twice.`;
}

async function submit({ token, business, chatId, buffer, mime, reference }) {
  const { httpStatus, body } = await submitPaymentProof({
    business,
    buffer,
    mime,
    txRef: business.payment_ref,
    // The stored method is the only thing the chat path has to go on — the
    // merchant never picks a rail here, they just send a picture.
    method: normaliseMethod(business.payment_method) || 'telebirr',
    plan: business.verifyet_plan || 'pro_monthly',
    bankReference: reference,
    source: 'bot',
  });
  await tg(token, 'sendMessage', { chat_id: chatId, text: replyFor(body, httpStatus), parse_mode: 'Markdown' });
  return httpStatus < 400;
}

/**
 * Owner sent a photo. Returns true if it was handled as a payment — in which
 * case the caller must NOT also run it through teachFromPhoto.
 */
export async function maybeHandlePaymentScreenshot({ token, business, msg, chatId }) {
  // Cheap gate first: no pending payment, no Vision call. A shop that has
  // never asked how to pay can send a thousand photos and never touch this.
  if (!hasPendingPayment(business)) return false;
  if (!msg.photo?.length) return false;

  let file;
  try { file = await downloadTelegramPhoto(token, msg); }
  catch (e) { console.warn('[owner-payment] download:', e.message); return false; }
  if (!file) return false;

  const read = await readPaymentScreenshot(file);
  // Not a receipt (or we couldn't tell) — hand it back to the normal photo
  // handling. A merchant's product photo is not a payment just because they
  // happen to owe us money.
  if (!read?.isPayment) return false;

  if (!read.reference) {
    // We can see it's a receipt but not read the number — the one case where
    // we still have to ask. Keep the file_id so they only send the number,
    // not the screenshot again.
    await setPendingProof(business, { file_id: msg.photo[msg.photo.length - 1].file_id, at: new Date().toISOString() });
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: `📄 That looks like a payment receipt, but I couldn't read the transaction number off it.\n\nReply with the transaction number (it's on your ${String(business.payment_method || '').includes('telebirr') ? 'Telebirr receipt' : 'CBE SMS'}) and I'll verify it.`,
      parse_mode: 'Markdown',
    });
    return true;
  }

  await tg(token, 'sendMessage', { chat_id: chatId, text: `⏳ Checking that payment — one moment…` });
  const ok = await submit({ token, business, chatId, buffer: file.buffer, mime: file.mime, reference: read.reference });
  if (ok) await setPendingProof(business, null);
  return true;
}

/**
 * Owner replied with the transaction number after we asked for it. Returns
 * true if it was consumed as that answer.
 */
export async function maybeHandlePaymentReferenceReply({ token, business, msg, chatId }) {
  if (!msg.text || !hasPendingPayment(business)) return false;
  const pending = pendingProof(business);
  if (!pending) return false;

  const candidate = msg.text.trim();
  // Only a code-shaped reply is an answer. Anything else means they moved on
  // to something else, so let it fall through to the normal owner handling
  // rather than swallowing their message.
  if (!REFERENCE_RE.test(candidate)) return false;

  let file;
  try { file = await downloadTelegramFile(token, pending.file_id); }
  catch (e) { console.warn('[owner-payment] re-download:', e.message); file = null; }
  if (!file) {
    await setPendingProof(business, null);
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: `⚠️ I lost track of that screenshot — could you send it again with the transaction number?`,
    });
    return true;
  }

  await tg(token, 'sendMessage', { chat_id: chatId, text: `⏳ Checking that payment — one moment…` });
  const ok = await submit({ token, business, chatId, buffer: file.buffer, mime: file.mime, reference: candidate });
  if (ok) await setPendingProof(business, null);
  return true;
}
