/**
 * Roll up reengagement_sends for humans — the admin dashboard tab and the
 * weekly admin digest both render these numbers, so they must come from one
 * place or the two views silently disagree.
 *
 * Pure — no I/O — so it is unit-testable by direct import. The callers do
 * their own supabase fetch (they differ in the time window) and pass the
 * rows in.
 */
import { STAGES } from './stages.mjs';
import { dayKeyEAT, lastNDaysEAT } from '../fetch-all.mjs';

export const STAGE_LABELS = {
  A1: 'Touched app, no account',
  B1: 'Account, unnamed',
  B2: 'Named shop',
  B3: 'Chat done',
  B4: 'Tried the AI',
  B5: 'Reached Go Live',
};

export const EXIT_LABELS = {
  too_complicated: '😵 Too complicated',
  no_time: '⏰ No time',
  too_expensive: '💸 Too expensive',
  just_looking: '👀 Just looking',
};

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function outcomeBuckets(rows) {
  const o = { completed: 0, advanced: 0, no_change: 0, pending: 0 };
  for (const s of rows) o[s.outcome || 'pending']++;
  return o;
}

/**
 * @param {Array<{stage, variant, sent_at, replied_at, exit_reason, outcome}>} rows
 * @param {{ days?: number, recentCount?: number }} [opts]
 * @returns {{ totals, by_stage, by_variant, exit_reasons, by_day, recent }}
 */
export function aggregateSends(rows, { days = 14, recentCount = 100 } = {}) {
  const sends = rows || [];

  // ── Totals ────────────────────────────────────────────────────────────────
  const replied = sends.filter(s => s.replied_at);
  const totals = {
    sent: sends.length,
    replied: replied.length,
    reply_rate: pct(replied.length, sends.length),
    outcomes: outcomeBuckets(sends),
  };

  // ── Per stage, in canonical ladder order ──────────────────────────────────
  const byStage = STAGES.map(stage => {
    const rows = sends.filter(s => s.stage === stage);
    const reps = rows.filter(s => s.replied_at);
    return {
      stage,
      label: STAGE_LABELS[stage] || stage,
      sent: rows.length,
      replied: reps.length,
      reply_rate: pct(reps.length, rows.length),
      outcomes: outcomeBuckets(rows),
    };
  });

  // ── Variant A/B (only A1/B1 actually branch; others record their arm) ────
  const byVariant = ['demand', 'payoff'].map(variant => {
    const rows = sends.filter(s => s.variant === variant);
    const reps = rows.filter(s => s.replied_at);
    return {
      variant,
      sent: rows.length,
      replied: reps.length,
      reply_rate: pct(reps.length, rows.length),
    };
  });

  // ── Exit reasons ──────────────────────────────────────────────────────────
  const reasonCounts = {};
  for (const s of sends) {
    if (!s.exit_reason) continue;
    reasonCounts[s.exit_reason] = (reasonCounts[s.exit_reason] || 0) + 1;
  }
  const exitReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, label: EXIT_LABELS[reason] || reason, count }))
    .sort((a, b) => b.count - a.count);

  // ── Cadence, last `days` in EAT ───────────────────────────────────────────
  const byDay = lastNDaysEAT(days).map(day => ({ day, sent: 0 }));
  const dayIndex = new Map(byDay.map(d => [d.day, d]));
  for (const s of sends) {
    const key = dayKeyEAT(s.sent_at);
    if (dayIndex.has(key)) dayIndex.get(key).sent++;
  }

  // Newest first, regardless of the caller's row order.
  const recent = [...sends]
    .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
    .slice(0, recentCount);

  return { totals, by_stage: byStage, by_variant: byVariant, exit_reasons: exitReasons, by_day: byDay, recent };
}
