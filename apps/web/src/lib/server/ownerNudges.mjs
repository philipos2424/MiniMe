/**
 * Owner nudge copy, selection and cooldown rules — pure, so node --test can
 * check every message Telegram will actually accept (see
 * __tests__/ownerNudges.test.mjs). The cron at api/cron/owner-nudges does
 * the I/O.
 */
import { PRO_PRICE_ETB } from '../plan.js';
import { escapeMd } from './reengage/copy.mjs';

export const DAY_MS = 86_400_000;

// Cooldowns, per nudge type and globally. Tweak here, not inline.
export const GLOBAL_COOLDOWN_MS  = 7 * DAY_MS;
export const PER_TYPE_COOLDOWN_MS = 21 * DAY_MS;
export const MAX_PER_TYPE = { never_taught: 2, no_products: 2, inactive_14d: 3, no_first_customer: 2, trial_ending_5d: 1, demand_weekly: 52, incomplete_catalog: 3 };
// demand_weekly is a Monday digest — its own cadence, not the 21-day default.
// no_first_customer: shops that ever go live mostly do it within a day or two
// (median 1 day), and the type only applies through day 14 — at the 21-day
// default its second send could never fire. Day 1, then day 4.
export const PER_TYPE_COOLDOWN_OVERRIDE_MS = { demand_weekly: 6 * DAY_MS, no_first_customer: 3 * DAY_MS };
// Time-critical nudges that may fire even inside the 7-day global cooldown —
// the trial recap lands near the end of the trial and should not be blocked by
// an earlier setup nudge.
export const GLOBAL_COOLDOWN_EXEMPT = new Set(['trial_ending_5d', 'no_first_customer']);

/** Telegram share sheet: opens the chat picker with link + caption prefilled. */
export function shareUrl(link, caption) {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(caption)}`;
}

/**
 * Telegram legacy-Markdown check: *bold*, _italic_ and `code` must all close
 * (no nesting; "\" escapes outside an entity). An unclosed one makes the
 * Bot API reject the whole message with "can't parse entities".
 */
export function legacyMarkdownOk(text) {
  let open = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!open && c === '\\') { i++; continue; }
    if (open) { if (c === open) open = null; continue; }
    if (c === '*' || c === '_' || c === '`') open = c;
  }
  return open === null;
}

/** Last-resort plain text: drop entity markers, unescape escaped characters. */
export function plainText(text) {
  return String(text).replace(/\\([_*`[\]])|[*_`]/g, (m, escaped) => escaped || '');
}

// Legacy Markdown has no escaping INSIDE an entity: in *bold* only "*" ends
// it ("\" would print literally), in _italic_ only "_" does. So values going
// inside an entity lose that one character; values outside get escapeMd().
export const inBold = s => String(s ?? '').replace(/\*/g, '');
export const inItalic = s => String(s ?? '').replace(/_/g, ' ');

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app')
    .trim().replace(/\/$/, '');
}

export function nudgeContent(type, rawBusiness) {
  // Every interpolated value is made safe for legacy Markdown. Unescaped, the
  // "_" in a shared-bot link (start=shop_<code>) opened an italic that never
  // closed, Telegram rejected the whole message, and no_first_customer went
  // undelivered to 104 of 109 eligible shops (2026-10-17). The shop name only
  // ever appears inside *bold*; the first name and links sit outside entities.
  const business = { ...rawBusiness, name: inBold(rawBusiness.name || 'your shop') };
  const first = escapeMd((rawBusiness.owner_name || '').split(' ')[0] || 'there');
  const url = appUrl();
  const stopHint = '\n\n_Tap "📱 Open MiniMe" below — or reply STOP to silence these reminders._';

  if (type === 'never_taught') {
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `Your *${business.name}* MiniMe assistant is set up — but it doesn't know your business yet. ` +
        `Until you teach it, it can only say "let me check with the owner." That's me bugging you 😅\n\n` +
        `*Two minutes to get it answering on its own:*\n` +
        `1. Open MiniMe → tap *Teach*\n` +
        `2. Paste your top 5 products or send a photo of your price list\n` +
        `3. Add your hours, location, and the 3 questions you get most\n\n` +
        `That's it. It'll handle the routine stuff and forward only the messages that actually need you.` +
        stopHint,
    };
  }

  if (type === 'no_products') {
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `Quick nudge — your *${business.name}* shop is live but your catalog is still empty.\n\n` +
        `Adding even *3 products* lets MiniMe quote prices, show photos, and take orders without waking you up. ` +
        `Open the app → *Teach* → paste a list or send a photo. Two minutes, max.` +
        stopHint,
    };
  }

  if (type === 'inactive_14d') {
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `It's been a couple of weeks since you checked in on *${business.name}* in MiniMe. ` +
        `Worth a peek — new messages, new customers, and any drafts waiting for your approval are all on the home screen.\n\n` +
        `If you've changed prices or added new products since, a quick *Teach* keeps the replies accurate.` +
        stopHint,
    };
  }

  if (type === 'no_first_customer') {
    const shopLink = business.telegram_bot_username
      ? `https://t.me/${business.telegram_bot_username}`
      : business.shop_code
        ? `https://t.me/MiniMeAgentBot?start=shop_${business.shop_code}`
        : url;
    const caption = `You can now order from ${rawBusiness.name || 'my shop'} on Telegram — ask anything, get an instant answer 👇`;
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `*${business.name}* is live — but no customer has messaged it yet. The fix is one share away.\n\n` +
        `Tap *📣 Share my shop* below and post it in ONE place where your customers already are — a Telegram group, your channel, or your status. ` +
        `The link and caption are filled in for you.\n\n` +
        `Or copy the link yourself:\n${escapeMd(shopLink)}\n\n` +
        `The first time MiniMe answers a real customer for you, you'll get it.` +
        stopHint,
      // t.me/share/url opens Telegram's chat picker with link + caption ready
      // to post — one tap instead of copy, switch app, paste.
      buttons: [[{ text: '📣 Share my shop', url: shareUrl(shopLink, caption) }]],
    };
  }

  if (type === 'incomplete_catalog') {
    const info = business._incomplete || { missingPrice: 0, missingPhoto: 0, examples: [] };
    const parts = [];
    if (info.missingPrice) parts.push(`*${info.missingPrice}* with no price`);
    if (info.missingPhoto) parts.push(`*${info.missingPhoto}* with no photo`);
    const examples = (info.examples || []).slice(0, 3).map(n => `• ${escapeMd(n)}`).join('\n');
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `Your *${business.name}* catalog is live, but ${parts.join(' and ')} ${(info.missingPrice + info.missingPhoto) === 1 ? 'is' : 'are'} missing info. ` +
        `MiniMe has to say "let me check with the owner" for those instead of answering instantly.\n\n` +
        (examples ? `For example:\n${examples}\n\n` : '') +
        `Add the missing price or photo and MiniMe can quote and show it right away — no back-and-forth.\n\n` +
        `Open MiniMe → *Products* → tap any item to fill it in.` +
        stopHint,
    };
  }

  if (type === 'demand_weekly') {
    const d = business._demand || {};
    const lines = [`Hi ${first} 👋\n`];
    if (d.top) {
      lines.push(
        `🔥 *This week on MiniMe Market:* your *${inBold(d.top.name)}* was viewed *${d.top.views}×*` +
        (d.top.clicks > 0 ? ` and *${d.top.clicks}* ${d.top.clicks === 1 ? 'person' : 'people'} tapped Order` : '') + `.`
      );
    }
    if (d.opportunities?.length) {
      lines.push(`\n🛒 *Customers are looking for things you could sell:*`);
      for (const o of d.opportunities) {
        lines.push(`• *${o.searches}* ${o.searches === 1 ? 'person' : 'people'} searched for _"${inItalic(o.query)}"_ and found nothing.`);
      }
      lines.push(`\nAdd ${d.opportunities.length === 1 ? 'it' : 'them'} to your catalog and those customers are yours — they get auto-notified the moment it appears.`);
    }
    return { text: lines.join('\n') + stopHint };
  }

  if (type === 'trial_ending_5d') {
    const s = business._stats || {};
    const replied = s.ai_messages_week || 0;
    const customers = s.customers_week || 0;
    const endDate = business.trial_ends_at
      ? new Date(business.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Africa/Addis_Ababa' })
      : null;
    const recap = replied > 0
      ? `This week I answered *${replied}* message${replied === 1 ? '' : 's'} from *${customers}* customer${customers === 1 ? '' : 's'}.\n\n`
      : '';
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `Your free trial for *${business.name}* ends in 5 days${endDate ? ` (${endDate})` : ''}.\n\n` +
        recap +
        `*After that, on Free:* I send up to 100 replies a month myself, then write the rest for you to send.\n` +
        `*On Pro (from ${PRO_PRICE_ETB.toLocaleString('en-US')} birr/month, less if you pay for 3 months or a year):* I keep sending replies myself, including nights and Sundays.\n\n` +
        `Nothing is charged automatically. To keep Pro, open MiniMe → *Settings → Billing* (Telebirr, CBE or card).` +
        stopHint,
    };
  }

  return null;
}

// Decide which (if any) nudge type applies to a given business. Returns the
// nudge key or null. Higher-priority types come first; the first match wins.
export function pickNudgeType({ business, productCount, documentCount, customerCount, aiMessagesWeek, daysSinceSignup, daysSinceActive, daysUntilTrialEnd, hasDemandDigest, hasIncompleteCatalog }) {
  const noProducts = productCount === 0;
  const noTeaching = documentCount === 0 && productCount === 0;

  // Trial recap — highest priority. Keyed off trial_ends_at (5 days out, a
  // 2-day window for the daily cron, one send), so it's right for any trial
  // length; it once fired on a fixed day 10 and told 30-day-trial owners their
  // trial ended "in a few days". cron/reminders sends the plain 3-day and
  // 1-day warnings, so this one only goes when there's real activity to show.
  if (
    business.subscription_status === 'trial' &&
    daysUntilTrialEnd != null && daysUntilTrialEnd > 3.5 && daysUntilTrialEnd <= 5.5 &&
    aiMessagesWeek >= 3
  ) return 'trial_ending_5d';

  // Live but zero customers ever — the activation moment that actually matters
  // is the first real customer message, not the Go Live tap. Push one share.
  if (customerCount === 0 && daysSinceSignup >= 1 && daysSinceSignup <= 14) return 'no_first_customer';

  if (noTeaching && daysSinceSignup >= 3) return 'never_taught';
  if (noProducts && daysSinceSignup >= 2) return 'no_products';

  // Has a catalog, but some products are missing a price or photo — those
  // silently degrade to "let me check with the owner" instead of an instant
  // answer, so this is worth flagging before we move on to growth-oriented nudges.
  if (hasIncompleteCatalog && daysSinceSignup >= 2) return 'incomplete_catalog';

  // Monday demand digest — the flywheel nudge. Only for merchants with a
  // catalog AND something real to say (own traction or matched unmet demand);
  // an empty digest would just be noise.
  if (hasDemandDigest && productCount > 0) return 'demand_weekly';

  if (productCount > 0 && daysSinceActive >= 14) return 'inactive_14d';
  return null;
}

export function isCooledDown(history, type, now) {
  const all = history?.sent || {};
  const global = history?.last_sent_at ? new Date(history.last_sent_at).getTime() : 0;
  if (global && now - global < GLOBAL_COOLDOWN_MS && !GLOBAL_COOLDOWN_EXEMPT.has(type)) return false;
  const t = all[type];
  if (!t) return true;
  if ((t.count || 0) >= (MAX_PER_TYPE[type] || 2)) return false;
  const last = t.last_at ? new Date(t.last_at).getTime() : 0;
  return now - last >= (PER_TYPE_COOLDOWN_OVERRIDE_MS[type] || PER_TYPE_COOLDOWN_MS);
}
