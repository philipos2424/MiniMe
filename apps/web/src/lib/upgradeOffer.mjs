/**
 * What /upgrade says (pure).
 *
 * The bot told owners "/upgrade" in at least five places — the free-reply
 * cap, the Secretary cap, contact cards, the draft nudge — and /upgrade had
 * no handler, so the one message that leads to payment got silence.
 */
import { planStatus, PRO_PERIODS, FREE_LIMITS } from './plan.js';

const n = (x) => Number(x).toLocaleString('en-US');

export function upgradeText(business, now = new Date()) {
  const st = planStatus(business);
  const P = PRO_PERIODS;
  if (st.isPro && !st.onTrial) {
    const until = business?.subscription_expires_at ? new Date(business.subscription_expires_at).toISOString().slice(0, 10) : null;
    return `✅ *You're on MiniMe Pro*${until ? ` until ${until}` : ''}.\n\nExtend any time from the billing page — the new period starts when the current one ends.`;
  }
  const head = st.onTrial
    ? `⏳ *Your Pro trial has ${st.trialDaysLeft} day${st.trialDaysLeft === 1 ? '' : 's'} left.* Keep everything running after it ends:`
    : `🚀 *MiniMe Pro*`;
  return [
    head,
    '',
    '• I send every reply myself — no daily cap, nights and Sundays included',
    `• Unlimited Secretary replies from your own account (Free: ${FREE_LIMITS.secretaryRepliesPerMonth}/month)`,
    `• Unlimited products (Free: ${FREE_LIMITS.products})`,
    '',
    `*${n(P.pro_monthly.amount)} ETB* a month`,
    `*${n(P.pro_quarterly.amount)} ETB* for 3 months — save ${n(P.pro_monthly.amount * 3 - P.pro_quarterly.amount)}`,
    `*${n(P.pro_annual.amount)} ETB* for a year — save ${n(P.pro_monthly.amount * 12 - P.pro_annual.amount)}`,
    '',
    'Pick a plan below — you pay by Telebirr or CBE and send the receipt right here in this chat.',
  ].join('\n');
}

export function upgradeKeyboard(appUrl) {
  const base = String(appUrl || '').replace(/\/$/, '');
  if (!base) return undefined;
  return { inline_keyboard: [[{ text: '💳 Upgrade to Pro', web_app: { url: `${base}/settings/billing?upgrade=1` } }]] };
}
