/**
 * GET /api/admin/reengagement — did the signup nudges work?
 *
 * Reads the reengagement_sends attribution table (one row per DM sent) and
 * rolls it up the way the copy-iteration loop needs:
 *   - by_stage   — send volume + reply rate per funnel rung (A1…B5)
 *   - by_variant — demand vs payoff reply rate, the A/B the copy tests
 *   - exit_reasons — why people said they stopped (exit-question chips)
 *   - by_day     — send cadence, last 14 days in EAT
 *   - recent     — per-recipient rows, newest first
 *
 * Outcomes come from the weekly sweep in reengage/outcomes.js: 'completed'
 * (went live), 'advanced' (moved up ≥1 rung), 'no_change', or null (too
 * fresh to resolve).
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';
import { STAGES } from '../../../../lib/server/reengage/stages.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_LABELS = {
  A1: 'Touched app, no account',
  B1: 'Account, unnamed',
  B2: 'Named shop',
  B3: 'Chat done',
  B4: 'Tried the AI',
  B5: 'Reached Go Live',
};

const EXIT_LABELS = {
  too_complicated: '😵 Too complicated',
  no_time: '⏰ No time',
  too_expensive: '💸 Too expensive',
  just_looking: '👀 Just looking',
};

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { data: rows, error } = await fetchAllRows(() => sb
    .from('reengagement_sends')
    .select('id, telegram_id, business_id, stage, variant, sent_at, replied_at, exit_reason, outcome')
    .order('sent_at', { ascending: false }));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sends = rows || [];
  const replied = sends.filter(s => s.replied_at);

  // ── Totals ────────────────────────────────────────────────────────────────
  const outcomes = { completed: 0, advanced: 0, no_change: 0, pending: 0 };
  for (const s of sends) outcomes[s.outcome || 'pending']++;

  const totals = {
    sent: sends.length,
    replied: replied.length,
    reply_rate: pct(replied.length, sends.length),
    outcomes,
  };

  // ── Per stage, in canonical ladder order ──────────────────────────────────
  const byStage = STAGES.map(stage => {
    const rows = sends.filter(s => s.stage === stage);
    const reps = rows.filter(s => s.replied_at);
    const o = { completed: 0, advanced: 0, no_change: 0, pending: 0 };
    for (const s of rows) o[s.outcome || 'pending']++;
    return {
      stage,
      label: STAGE_LABELS[stage] || stage,
      sent: rows.length,
      replied: reps.length,
      reply_rate: pct(reps.length, rows.length),
      outcomes: o,
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

  // ── Cadence, last 14 days EAT ─────────────────────────────────────────────
  const byDay = lastNDaysEAT(14).map(day => ({ day, sent: 0 }));
  const dayIndex = new Map(byDay.map(d => [d.day, d]));
  for (const s of sends) {
    const key = dayKeyEAT(s.sent_at);
    if (dayIndex.has(key)) dayIndex.get(key).sent++;
  }

  return NextResponse.json({ totals, by_stage: byStage, by_variant: byVariant, exit_reasons: exitReasons, by_day: byDay, recent: sends.slice(0, 100) });
}
