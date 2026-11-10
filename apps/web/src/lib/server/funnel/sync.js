/**
 * Funnel sync + report loading — the I/O around the pure builders in
 * derive.mjs and weeklyReport.mjs (spec §1).
 *
 * The sync reads source tables, derives funnel_events and inserts only the
 * rows that are missing. A normal run loads SYNC_WINDOW_DAYS of messages;
 * a backfill loads the full history. Both are idempotent.
 */
import { supabase } from '../db';
import { getAdminIds } from '../admin';
import { getSetting } from '../platformSettings';
import { fetchAllRows } from '../fetch-all.mjs';
import { deriveFunnelEvents, newEvents } from './derive.mjs';
import { buildWeeklyReport } from './weeklyReport.mjs';

/**
 * Messages loaded by a normal sync and by the report. Must cover the 30-day
 * concentration figure plus a full 7-day activation window for any shop that
 * onboarded since the previous weekly run.
 */
export const SYNC_WINDOW_DAYS = 35;
const BACKFILL_MAX_MESSAGES = 2_000_000;
const INSERT_CHUNK = 500;

const BUSINESS_COLS = 'id, name, created_at, updated_at, is_internal, owner_telegram_id, sub_admin_telegram_ids, onboarding_completed, onboarding_completed_at, trial_started_at, payment_proof_url';

/** Off switch: platform setting `funnel.tracking` (or env FUNNEL_TRACKING) = 'off'. */
export async function funnelTrackingEnabled() {
  const v = await getSetting('funnel.tracking').catch(() => null);
  return String(v || '').trim().toLowerCase() !== 'off';
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function loadInputs(sb, { messagesSince, maxMessages }) {
  const inbound = () => {
    let q = sb.from('messages').select('business_id, conversation_id, customer_id, created_at').eq('direction', 'inbound');
    if (messagesSince) q = q.gte('created_at', messagesSince);
    return q.order('created_at').order('id');
  };
  const [businesses, customers, messages, existing] = await Promise.all([
    must('businesses', fetchAllRows(() => sb.from('businesses').select(BUSINESS_COLS).order('id'))),
    must('customers', fetchAllRows(() => sb.from('customers').select('id, business_id, telegram_id').order('id'), { maxRows: 1_000_000 })),
    must('messages', fetchAllRows(inbound, maxMessages ? { maxRows: maxMessages } : undefined)),
    must('funnel_events', fetchAllRows(() => sb.from('funnel_events')
      .select('business_id, event, occurred_at, dedupe_key, metadata').order('id'), { maxRows: 1_000_000 })),
  ]);
  return { businesses, customers, messages, existing };
}

/**
 * Derive and insert missing funnel events.
 * @returns counts per event of what was (or, on dryRun, would be) inserted
 */
export async function syncFunnelEvents({ backfill = false, dryRun = false, now = Date.now() } = {}) {
  const sb = supabase();
  const messagesSince = backfill ? null : new Date(now - SYNC_WINDOW_DAYS * 86400000).toISOString();
  const maxMessages = backfill ? BACKFILL_MAX_MESSAGES : 500_000;
  const adminIds = getAdminIds();

  const [{ businesses, customers, messages, existing }, onboardingEvents, subscriptionEvents, paymentVerifications] = await Promise.all([
    loadInputs(sb, { messagesSince, maxMessages }),
    must('onboarding_events', fetchAllRows(() => sb.from('onboarding_events')
      .select('telegram_id, step, created_at')
      .in('step', ['connected', 'connected_shared', 'connected_custom', 'trial_started']).order('id'))),
    must('subscription_events', fetchAllRows(() => sb.from('subscription_events')
      .select('id, business_id, event, plan, amount_etb, meta, created_at').order('created_at').order('id'))),
    must('payment_verifications', fetchAllRows(() => sb.from('payment_verifications')
      .select('id, business_id, method, our_reference, bank_reference, created_at').order('created_at').order('id'))),
  ]);

  const derived = deriveFunnelEvents({
    businesses, customers, messages, onboardingEvents, subscriptionEvents, paymentVerifications,
    adminIds, messagesSince, source: backfill ? 'backfill' : 'sync',
  });
  const fresh = newEvents(derived, existing);

  if (!dryRun) {
    for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
      const { error } = await sb.from('funnel_events')
        .upsert(fresh.slice(i, i + INSERT_CHUNK), { onConflict: 'business_id,event,dedupe_key', ignoreDuplicates: true });
      if (error) throw new Error(`funnel_events insert: ${error.message}`);
    }
  }

  const count = rows => rows.reduce((acc, e) => { acc[e.event] = (acc[e.event] || 0) + 1; return acc; }, {});
  return {
    mode: backfill ? 'backfill' : 'sync',
    dry_run: dryRun,
    messages_loaded: messages.length,
    messages_truncated: messages.length >= maxMessages,
    existing_events: existing.length,
    derived: count(derived),
    inserted: count(fresh),
    // The same numbers scripts/funnel-reconcile.sql produces by hand.
    reconcile: {
      shops_total: businesses.length,
      shops_internal: businesses.filter(b => b.is_internal === true).length,
      shops_onboarding_completed: businesses.filter(b => b.is_internal !== true && b.onboarding_completed).length,
    },
  };
}

/** True when the table has never been filled — the first run must backfill. */
export async function funnelEventsEmpty() {
  const { count, error } = await supabase().from('funnel_events').select('id', { count: 'exact', head: true });
  if (error) throw new Error(`funnel_events: ${error.message}`);
  return !count;
}

export async function loadWeeklyReport({ now = Date.now() } = {}) {
  const sb = supabase();
  const messagesSince = new Date(now - SYNC_WINDOW_DAYS * 86400000).toISOString();
  const { businesses, customers, messages, existing } = await loadInputs(sb, { messagesSince, maxMessages: 500_000 });
  return buildWeeklyReport({ businesses, customers, events: existing, messages, adminIds: getAdminIds(), now });
}
