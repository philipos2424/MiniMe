/**
 * Who gets a nudge on this run?
 *
 * Candidates come from onboarding_events (every telegram_id that ever touched
 * the funnel), left-joined to businesses. Stage detection and the send
 * schedule are pure and live in stages.mjs / eligibility.mjs; this module is
 * only the I/O and the ordering around them.
 *
 * The daily cap is the safety valve: the first production run faces the entire
 * historical backlog, and blasting it would spend every dormant lead on one
 * untested piece of copy.
 */
import { supabase } from '../db';
import { isAdmin } from '../admin';
import { detectStage } from './stages.mjs';
import { decideSend, pickVariant } from './eligibility.mjs';

export const DEFAULT_CAP = Number(process.env.REENGAGE_DAILY_CAP || 50);

export async function loadCandidates({ now = Date.now(), cap = DEFAULT_CAP } = {}) {
  const sb = supabase();

  const { data: events, error: evErr } = await sb
    .from('onboarding_events')
    .select('telegram_id, step, created_at')
    .not('telegram_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50000);
  if (evErr) throw new Error(`onboarding_events query failed: ${evErr.message}`);

  // Fold to one record per person: their step set and their most recent event.
  const byUser = new Map();
  for (const e of events || []) {
    const key = String(e.telegram_id);
    let rec = byUser.get(key);
    if (!rec) {
      rec = { telegramId: e.telegram_id, steps: [], stalledAt: e.created_at };
      byUser.set(key, rec);
    }
    rec.steps.push(e.step);
    if (new Date(e.created_at) > new Date(rec.stalledAt)) rec.stalledAt = e.created_at;
  }
  if (!byUser.size) return [];

  const ids = [...byUser.values()].map(r => r.telegramId);

  const { data: businesses } = await sb
    .from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, onboarding_completed, telegram_bot_username, notification_prefs')
    .in('owner_telegram_id', ids);
  const bizByOwner = new Map((businesses || []).map(b => [String(b.owner_telegram_id), b]));

  const { data: priorSends } = await sb
    .from('reengagement_sends')
    .select('telegram_id, sent_at')
    .in('telegram_id', ids);
  const sendsByUser = new Map();
  for (const s of priorSends || []) {
    const key = String(s.telegram_id);
    if (!sendsByUser.has(key)) sendsByUser.set(key, []);
    sendsByUser.get(key).push(s);
  }

  const eligible = [];
  for (const rec of byUser.values()) {
    const key = String(rec.telegramId);
    const business = bizByOwner.get(key) || null;
    const stage = detectStage({ steps: rec.steps, business });
    const sends = sendsByUser.get(key) || [];
    const optedOut = business?.notification_prefs?.owner_nudges?.opted_out === true;

    const decision = decideSend({
      stage,
      sends,
      stalledAt: rec.stalledAt,
      optedOut,
      isAdminUser: isAdmin(rec.telegramId),
      now,
    });
    if (!decision.send) continue;

    eligible.push({
      telegramId: rec.telegramId,
      business,
      steps: rec.steps,
      stalledAt: rec.stalledAt,
      sends,
      stage,
      variant: pickVariant(rec.telegramId, stage),
      decision,
    });
  }

  // Oldest stall first — the backlog drains in the order it accumulated.
  eligible.sort((a, b) => new Date(a.stalledAt) - new Date(b.stalledAt));
  return eligible.slice(0, cap);
}
