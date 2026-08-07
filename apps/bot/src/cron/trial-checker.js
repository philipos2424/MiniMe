const { findAll: findAllBusinesses, update: updateBusiness, socialProofLine } = require('../../../../packages/db/queries/businesses');
const { countAiRepliesSince } = require('../../../../packages/db/queries/messages');
const { findByBusiness: findProducts } = require('../../../../packages/db/queries/products');
const { PRO_PRICE_LABEL } = require('../../../../packages/shared/plan');

// Nudge stages, in the order they fire. `stage` is stored on
// businesses.trial_warn_stage so each one sends exactly once.
//
// The old checker matched the countdown with exact equality (daysLeft === 3),
// so a missed or delayed cron run silently skipped a warning entirely and a
// double run sent it twice. These are `>=`-style thresholds guarded by the
// recorded stage instead.
const TRIAL_STAGES = [
  { stage: 7, atOrBelowDays: 7 },
  { stage: 3, atOrBelowDays: 3 },
  { stage: 1, atOrBelowDays: 1 },
];

// Post-expiry win-back. Days are counted from trial_ends_at.
const WINBACK_STAGES = [
  { stage: -7,  afterDays: 7 },
  { stage: -30, afterDays: 30 },
];

/**
 * What the free month actually did for this shop. Leading with value received
 * converts better than only listing what's about to lock — and we have the data.
 */
async function trialImpact(business) {
  const since = business.trial_started_at || business.created_at;
  const [replies, products] = await Promise.all([
    since ? countAiRepliesSince(business.id, new Date(since).toISOString()) : 0,
    findProducts(business.id).catch(() => []),
  ]);
  return { replies, products: (products || []).length };
}

function impactLine({ replies, products }) {
  const parts = [];
  if (replies > 0) parts.push(`answered *${replies}* customer message${replies === 1 ? '' : 's'} for you`);
  if (products > 0) parts.push(`listed *${products}* product${products === 1 ? '' : 's'}`);
  if (!parts.length) return '';
  return `In your free month MiniMe ${parts.join(' and ')}.\n\n`;
}

async function checkTrials() {
  try {
    const bot = require('../../server').bot;
    const businesses = await findAllBusinesses();
    const now = Date.now();

    // Fetched once per run, not per shop — it's identical for everyone and
    // cached for an hour anyway. Empty string when we have nothing honest.
    const proof = await socialProofLine();

    for (const business of businesses) {
      if (!business.trial_ends_at) continue;
      if (!business.owner_private_chat_id) continue;

      // Never nudge a paying shop.
      const tier = business.plan_tier || business.subscription_plan;
      if (tier === 'pro' || business.subscription_status === 'active') continue;
      if (business.subscription_status === 'cancelled') continue;

      const trialEnd = new Date(business.trial_ends_at).getTime();
      const daysLeft = Math.ceil((trialEnd - now) / 86400000);
      const sent = business.trial_warn_stage;

      // ── Still on trial: 7 → 3 → 1 ────────────────────────────────────────
      if (business.subscription_status === 'trial' && daysLeft > 0) {
        // Furthest-along stage this shop now qualifies for.
        const due = TRIAL_STAGES.filter(s => daysLeft <= s.atOrBelowDays)
          .sort((a, b) => a.stage - b.stage)[0];
        // `sent` counts DOWN (7 then 3 then 1), so a stage is new only if it is
        // strictly smaller than what we already sent. NULL means nothing sent.
        if (!due) continue;
        if (sent !== null && sent !== undefined && due.stage >= sent) continue;

        const impact = impactLine(await trialImpact(business));
        const dayWord = daysLeft === 1 ? 'tomorrow' : `in *${daysLeft} days*`;

        // NOTE: the free month ending does NOT stop MiniMe. The shop drops to
        // the Free plan — customer replies continue; only the Pro extras lock.
        // Copy here must never imply the bot goes dark, and we must not touch
        // trust_level (that would silently turn off auto-replies).
        await bot.sendMessage(business.owner_private_chat_id,
          `⏳ Your free month ends ${dayWord}.\n\n` +
          impact +
          `On Free, MiniMe keeps writing every one of those replies for you — ` +
          `that never stops, and your shop stays listed on MiniMe Search.\n\n` +
          `*The difference: you'll be the one tapping send.* Every message, ` +
          `including the ones at 11pm.\n\n` +
          `💰 One shop earned *16,000 ETB* from orders MiniMe handled while they ` +
          `were away. _(One shop's result — yours depends on your own customers.)_\n\n` +
          proof +
          `/upgrade — ${PRO_PRICE_LABEL}`,
          { parse_mode: 'Markdown' }
        );
        await updateBusiness(business.id, { trial_warn_stage: due.stage });
        continue;
      }

      // ── Trial just ran out: drop to Free ─────────────────────────────────
      if (business.subscription_status === 'trial' && daysLeft <= 0) {
        const impact = impactLine(await trialImpact(business));
        await updateBusiness(business.id, {
          subscription_status: 'expired',
          trial_warn_stage: 0,
        });
        await bot.sendMessage(business.owner_private_chat_id,
          `ℹ️ Your free month is over — you're now on *MiniMe Free*.\n\n` +
          impact +
          `Nothing has been switched off: MiniMe still reads every message and still ` +
          `writes the reply, unlimited, and your shop is still listed on MiniMe Search.\n\n` +
          `From now on you'll get each reply to check and send yourself.\n\n` +
          proof +
          `/upgrade and MiniMe goes back to sending them for you — ${PRO_PRICE_LABEL}`,
          { parse_mode: 'Markdown' }
        );
        continue;
      }

      // ── Win-back: day 7 and day 30 on Free ───────────────────────────────
      // Nothing followed up after expiry before, so owners who simply weren't
      // ready at the deadline were never asked again.
      if (business.subscription_status === 'expired') {
        const daysSince = Math.floor((now - trialEnd) / 86400000);
        // Ascending = furthest-along stage first, so a shop that has been on
        // Free for 40 days goes straight to the day-30 note rather than
        // stepping through day-7 first.
        const due = WINBACK_STAGES.filter(s => daysSince >= s.afterDays)
          .sort((a, b) => a.stage - b.stage)[0];
        if (!due) continue;
        if (sent !== null && sent !== undefined && due.stage >= sent) continue;

        const { replies } = await trialImpact(business);
        await bot.sendMessage(business.owner_private_chat_id,
          `👋 MiniMe has written *${replies}* repl${replies === 1 ? 'y' : 'ies'} for you — ` +
          `and you've tapped send on every one.\n\n` +
          `On Pro they just go out. Nights, Sundays, while you're with a customer.\n\n` +
          proof +
          `/upgrade — ${PRO_PRICE_LABEL}`,
          { parse_mode: 'Markdown' }
        );
        await updateBusiness(business.id, { trial_warn_stage: due.stage });
      }
    }
  } catch (e) {
    console.error('checkTrials error:', e.message);
  }
}

module.exports = { checkTrials };
