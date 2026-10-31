/**
 * Paying for Pro inside the bot chat (pure parts).
 *
 * The /upgrade button opened the Mini App, and on phones Telegram often
 * reuses a Mini App window that is already open, so owners landed on Home
 * instead of checkout. Paying is now a chat flow: pick a period, pick
 * Telebirr or CBE, send the money, send the screenshot here.
 */
import { PRO_PERIODS } from './plan.js';

const n = (x) => Number(x).toLocaleString('en-US');
export const AWAIT_HOURS = 48;

export function planKeyboard(appUrl) {
  const P = PRO_PERIODS;
  const rows = [
    [{ text: `1 month · ${n(P.pro_monthly.amount)} ETB`, callback_data: 'upg_plan_pro_monthly' }],
    [{ text: `3 months · ${n(P.pro_quarterly.amount)} ETB (save ${n(P.pro_monthly.amount * 3 - P.pro_quarterly.amount)})`, callback_data: 'upg_plan_pro_quarterly' }],
    [{ text: `1 year · ${n(P.pro_annual.amount)} ETB (save ${n(P.pro_monthly.amount * 12 - P.pro_annual.amount)})`, callback_data: 'upg_plan_pro_annual' }],
  ];
  const base = String(appUrl || '').replace(/\/$/, '');
  if (base) rows.push([{ text: '📱 Or pay in the app', web_app: { url: `${base}/settings/billing?upgrade=1` } }]);
  return { inline_keyboard: rows };
}

export function methodKeyboard(planKey, { telebirr = true, bank = true } = {}) {
  const row = [];
  if (telebirr) row.push({ text: '📱 Telebirr', callback_data: `upg_pay_${planKey}_telebirr` });
  if (bank) row.push({ text: '🏦 CBE bank', callback_data: `upg_pay_${planKey}_bank` });
  return { inline_keyboard: [row, [{ text: '← Back', callback_data: 'upg_back' }]] };
}

export const refCode = (businessId) => `SUB-${String(businessId || '').slice(0, 6).toUpperCase()}`;

export function payInstructions({ planKey, method, accounts, businessId }) {
  const p = PRO_PERIODS[planKey];
  if (!p) return null;
  const tele = method === 'telebirr';
  const acct = tele ? accounts?.telebirr : accounts?.bank;
  if (tele ? !acct?.phone : !acct?.account) return null; // never show a placeholder account
  const lines = [
    `💳 *MiniMe Pro — ${p.label}: ${n(p.amount)} ETB*`,
    '',
    tele ? `1. Send *${n(p.amount)} ETB* by Telebirr to:` : `1. Transfer *${n(p.amount)} ETB* to:`,
    tele ? `   📱 \`${acct.phone}\`${acct.name ? ` (${acct.name})` : ''}` : `   🏦 ${acct.bankName || 'Bank'} \`${acct.account}\`${acct.name ? ` (${acct.name})` : ''}`,
    `   Reason/reference: \`${refCode(businessId)}\``,
    '',
    `2. Send me the *screenshot* of the payment right here, with the *transaction number* as the caption${tele ? ' (it\'s in your Telebirr SMS, e.g. CH12AB34CD)' : ' (the FT… number from your CBE SMS)'}.`,
    '',
    'I check it with the bank and switch Pro on — usually within a minute.',
  ];
  return lines.join('\n');
}

/**
 * A bank transaction number in what the owner wrote: 8–20 letters and digits,
 * both present. Our own SUB- reference and phone numbers don't count.
 */
export function extractBankRef(text) {
  const t = String(text || '').toUpperCase();
  for (const m of t.matchAll(/\b[A-Z0-9]{8,20}\b/g)) {
    const tok = m[0];
    if (!/[A-Z]/.test(tok) || !/\d/.test(tok)) continue;
    if (/^SUB/.test(tok) || /^(251|09|07)\d+$/.test(tok)) continue;
    return tok;
  }
  return null;
}

/** The pending in-chat payment, if it's still fresh. */
export function activeUpgrade(prefs, now = new Date()) {
  const a = prefs?.awaiting_sub_proof;
  if (!a?.txRef || !a?.at) return null;
  return (now - new Date(a.at)) / 3600000 <= AWAIT_HOURS ? a : null;
}

export function resultText(status, body) {
  if (status >= 400) return `⚠️ ${body?.message || body?.error || 'I couldn\'t submit that payment.'}`;
  if (body?.status === 'verifying') return `⏳ ${body.message || 'Checking your payment with the bank — I\'ll message you the moment it clears.'}`;
  return null; // active / review: the verification step already messaged the owner
}
