/**
 * GET /api/admin/outreach/feedback-prompts — response-rate stats for
 * proactive feedback prompts, grouped by rule.
 *
 * Complements GET /api/platform/feedback (which lists organic + prompted
 * feedback content); this route is about the prompts themselves — how many
 * were sent vs. answered.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';
import { fetchAllRows } from '../../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { data: prompts, error } = await fetchAllRows(() =>
    sb.from('feedback_prompts').select('id, rule_id, responded_at, created_at').order('created_at', { ascending: false }));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: rules } = await sb.from('outreach_rules').select('id, key, name').eq('kind', 'feedback_prompt');
  const ruleName = Object.fromEntries((rules || []).map(r => [r.id, { key: r.key, name: r.name }]));

  const byRule = {};
  let totalSent = 0, totalResponded = 0;
  for (const p of prompts || []) {
    totalSent++;
    const responded = !!p.responded_at;
    if (responded) totalResponded++;
    const key = p.rule_id || 'unknown';
    const bucket = byRule[key] || (byRule[key] = { rule_id: p.rule_id, rule_key: ruleName[p.rule_id]?.key || null, rule_name: ruleName[p.rule_id]?.name || 'Unknown rule', sent: 0, responded: 0 });
    bucket.sent++;
    if (responded) bucket.responded++;
  }

  const rows = Object.values(byRule).map(b => ({ ...b, response_rate: b.sent ? Math.round((b.responded / b.sent) * 1000) / 10 : 0 }));
  rows.sort((a, b) => b.sent - a.sent);

  return NextResponse.json({
    total_sent: totalSent,
    total_responded: totalResponded,
    overall_response_rate: totalSent ? Math.round((totalResponded / totalSent) * 1000) / 10 : 0,
    by_rule: rows,
  });
}
