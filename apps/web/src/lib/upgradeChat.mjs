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

/** Any bot text that says "/upgrade" gets the plan buttons under it. */
export const mentionsUpgrade = (text) => /(^|\s)\/upgrade\b/.test(String(text || ''));

/**
 * Buttons for an owner reminder: payment reminders get the plan buttons (pay
 * in chat), setup reminders get "do it here in chat" (the /setup guide), the
 * rest open the app.
 */
export function nudgeKeyboard(type, appUrl) {
  const base = String(appUrl || '').replace(/\/$/, '');
  const app = base ? [{ text: '📱 Open MiniMe', web_app: { url: base } }] : null;
  if (['trial_ending_5d', 'pro_renewal', 'pro_lapsed'].includes(type)) return planKeyboard(appUrl);
  if (['never_taught', 'no_products', 'incomplete_catalog'].includes(type)) {
    return { inline_keyboard: [[{ text: '🧭 Set it up here in chat', callback_data: 'setup_open' }], ...(app ? [app] : [])] };
  }
  return app ? { inline_keyboard: [app] } : undefined;
}

/** Days until a paid Pro window ends (negative once it has), or null when there's none to remind about. */
export function daysUntilProEnd(business, now = Date.now()) {
  if (!business?.subscription_expires_at) return null;
  if (!['active', 'pending_review'].includes(business.subscription_status)) return null;
  return (new Date(business.subscription_expires_at).getTime() - now) / 86400000;
}

export function proEndText(type, business, days) {
  const first = String(business?.owner_name || '').split(' ')[0] || 'there';
  const date = business?.subscription_expires_at
    ? new Date(business.subscription_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Africa/Addis_Ababa' })
    : '';
  if (type === 'pro_renewal') {
    const d = Math.max(1, Math.ceil(days));
    return `Hi ${first} 👋\n\nYour MiniMe Pro for *${business.name}* ends in *${d} day${d === 1 ? '' : 's'}*${date ? ` (${date})` : ''}.\n\nRenew in one tap below — pay by Telebirr or CBE right here in the chat. Nothing is charged automatically.`;
  }
  return `Hi ${first},\n\nYour MiniMe Pro for *${business.name}* ended${date ? ` on ${date}` : ''}. MiniMe still writes every reply — you send them yourself until you renew.\n\nPick a plan below to switch it back on.`;
}
