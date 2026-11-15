/**
 * Derive funnel_events rows from tables that already exist (spec §1).
 *
 * Pure: plain rows in, rows ready to insert out. The weekly sync and the
 * one-off backfill both call this, so they can never disagree. Every row
 * carries a (business_id, event, dedupe_key) identity that the table's
 * unique key enforces — running it twice inserts nothing new.
 *
 * Internal (test) shops produce no events at all.
 */
import { isInternal, realInboundMessages, activationTime } from './events.mjs';

const ms = v => new Date(v).getTime();
const earliest = (a, b) => (a == null ? b : b == null ? a : ms(a) <= ms(b) ? a : b);

/** onboarding_events steps that mean "the shop went live". */
const LIVE_STEPS = new Set(['connected', 'connected_shared', 'connected_custom', 'trial_started']);
/** subscription_events written by an admin flipping a status — a grant, not money. */
const GRANT_SOURCES = new Set(['admin_edit', 'bulk_activate']);

/**
 * Best known time a shop finished onboarding, with how sure we are.
 * Exact once the 067 trigger is live; approximated for older rows.
 */
export function onboardedAt(business, liveStepAt) {
  if (!business?.onboarding_completed) return null;
  if (business.onboarding_completed_at) return { at: business.onboarding_completed_at, basis: 'trigger' };
  if (liveStepAt) return { at: liveStepAt, basis: 'onboarding_events' };
  if (business.trial_started_at) return { at: business.trial_started_at, basis: 'trial_started_at' };
  return { at: business.created_at, basis: 'created_at' };
}

/**
 * @param {object} input
 * @param {string|null} input.messagesSince  ISO lower bound of `messages`, or
 *   null when the full history was loaded. Activation is only judged for
 *   shops whose whole 7-day window is covered by the loaded messages.
 * @param {'sync'|'backfill'} input.source
 */
export function deriveFunnelEvents({
  businesses = [], customers = [], messages = [], onboardingEvents = [],
  subscriptionEvents = [], paymentVerifications = [], adminIds = [],
  messagesSince = null, source = 'sync',
}) {
  const external = businesses.filter(b => b && !isInternal(b));
  const externalIds = new Set(external.map(b => b.id));
  const out = [];
  const push = (business_id, event, occurred_at, dedupe_key = '', metadata = {}) => {
    if (!occurred_at || Number.isNaN(ms(occurred_at))) return;
    out.push({ business_id, event, occurred_at: new Date(occurred_at).toISOString(), dedupe_key, metadata, source });
  };

  // First "went live" wizard event per owner telegram id.
  const liveStepByOwner = new Map();
  for (const e of onboardingEvents) {
    if (e.telegram_id == null || !LIVE_STEPS.has(e.step)) continue;
    const k = String(e.telegram_id);
    liveStepByOwner.set(k, earliest(liveStepByOwner.get(k), e.created_at));
  }

  const realByBiz = new Map();
  for (const m of realInboundMessages({ businesses: external, customers, messages, adminIds })) {
    if (!realByBiz.has(m.business_id)) realByBiz.set(m.business_id, []);
    realByBiz.get(m.business_id).push(m);
  }

  const subsByBiz = new Map();
  for (const e of subscriptionEvents) {
    if (!externalIds.has(e.business_id)) continue;
    if (!subsByBiz.has(e.business_id)) subsByBiz.set(e.business_id, []);
    subsByBiz.get(e.business_id).push(e);
  }

  for (const b of external) {
    push(b.id, 'registered', b.created_at);

    const onb = onboardedAt(b, liveStepByOwner.get(String(b.owner_telegram_id)));
    if (onb) {
      push(b.id, 'onboarding_completed', onb.at, '',
        onb.basis === 'trigger' ? {} : { approximate: true, basis: onb.basis });
    }

    const real = realByBiz.get(b.id) || [];
    if (real.length) push(b.id, 'first_customer_message', real[0].created_at);

    if (onb && (!messagesSince || ms(onb.at) >= ms(messagesSince))) {
      const at = activationTime(onb.at, real);
      if (at) push(b.id, 'activated', at);
    }

    const subs = (subsByBiz.get(b.id) || []).sort((x, y) => ms(x.created_at) - ms(y.created_at));
    const trialEvent = subs.find(e => e.event === 'trial_started');
    const trialAt = earliest(trialEvent?.created_at, b.trial_started_at);
    if (trialAt) push(b.id, 'trial_started', trialAt);

    let hasPaid = false;
    for (const e of subs) {
      const via = e.meta?.source || null;
      const key = `se:${e.id}`;
      if (e.event === 'subscribed' && !GRANT_SOURCES.has(via)) {
        hasPaid = true;
        push(b.id, 'payment_confirmed', e.created_at, key, { plan: e.plan || null, amount_etb: e.amount_etb ?? null, via });
      } else if (e.event === 'renewed') {
        hasPaid = true;
        push(b.id, 'subscription_renewed', e.created_at, key, { plan: e.plan || null, amount_etb: e.amount_etb ?? null, via });
      } else if ((e.event === 'churned' || e.event === 'expired') && hasPaid && via !== 'admin_review') {
        // Only a shop that actually paid can churn. A lapsed trial or a
        // rejected receipt ('admin_review') is not churn.
        push(b.id, 'churned', e.created_at, key, { reason: e.event });
      }
    }
  }

  // payment_submitted: one per receipt reference. A single submission can
  // log several verification rows (queued, then webhook), so key on the
  // reference and keep the earliest.
  const submitted = new Map();
  for (const v of paymentVerifications) {
    if (!externalIds.has(v.business_id)) continue;
    const ref = v.our_reference || v.bank_reference || v.id;
    const k = `${v.business_id}|${ref}`;
    const cur = submitted.get(k);
    if (!cur || ms(v.created_at) < ms(cur.at)) {
      submitted.set(k, { business_id: v.business_id, ref, at: v.created_at, method: v.method || null });
    }
  }
  const withSubmission = new Set();
  for (const s of submitted.values()) {
    withSubmission.add(s.business_id);
    push(s.business_id, 'payment_submitted', s.at, `ref:${s.ref}`, { method: s.method });
  }
  // History only: a receipt was uploaded before submissions were logged.
  // Not done on a normal sync — the live hook covers new uploads, and this
  // row has no reference to de-duplicate against.
  if (source === 'backfill') {
    for (const b of external) {
      if (b.payment_proof_url && !withSubmission.has(b.id)) {
        push(b.id, 'payment_submitted', b.updated_at || b.created_at, 'legacy', { approximate: true, basis: 'payment_proof_url' });
      }
    }
  }

  return out;
}

const identity = e => `${e.business_id}|${e.event}|${e.dedupe_key || ''}`;

/** Rows from `derived` that are not already in `existing`. */
export function newEvents(derived, existing) {
  const have = new Set((existing || []).map(identity));
  // A 'legacy' row has no reference to match on, so it only goes in when
  // the shop has no recorded submission of any kind.
  const haveKind = new Set((existing || []).map(e => `${e.business_id}|${e.event}`));
  const seen = new Set();
  return (derived || []).filter(e => {
    const k = identity(e);
    if (have.has(k) || seen.has(k)) return false;
    if (e.dedupe_key === 'legacy' && haveKind.has(`${e.business_id}|${e.event}`)) return false;
    seen.add(k);
    return true;
  });
}
