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
 * The rollup itself lives in lib/server/reengage/summary.mjs, shared with the
 * weekly admin digest so the two views can never disagree. Outcomes come from
 * the weekly sweep in reengage/outcomes.js: 'completed' (went live),
 * 'advanced' (moved up ≥1 rung), 'no_change', or null (too fresh to resolve).
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';
import { aggregateSends } from '../../../../lib/server/reengage/summary.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { data: rows, error } = await fetchAllRows(() => sb
    .from('reengagement_sends')
    .select('id, telegram_id, business_id, stage, variant, sent_at, replied_at, exit_reason, outcome')
    .order('sent_at', { ascending: false }));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(aggregateSends(rows || [], { recentCount: 100 }));
}
