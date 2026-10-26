/**
 * GET /api/admin/health — the Platform health tab: failure rates, not "it ran".
 *
 * Reads only the last 24 h of messages, AI calls and webhook events plus the
 * metrics job's run log, and computes everything in
 * lib/server/metrics/health.mjs — the same definitions Insights and Pulse use,
 * so the tabs can't disagree. Aggregates only; no message text.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';
import { platformHealth } from '../../../../lib/server/metrics/health.mjs';
import { DAILY_SUMMARY_ROUTE } from '../../../../lib/server/llmCallLog.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store' };

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

export async function GET(request) {
  if (!(await requireAdminRequest(request))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }
  const sb = supabase();
  const now = Date.now();
  const since = new Date(now - 86400000).toISOString();
  try {
    const [internal, recentMessages, llmRecent, webhooks, runs] = await Promise.all([
      must('businesses', sb.from('businesses').select('id').eq('is_internal', true)),
      must('messages', fetchAllRows(() => sb.from('messages')
        .select('business_id, direction, status, created_at').eq('direction', 'outbound').gte('created_at', since).order('created_at').order('id'))),
      must('llm_call_log', fetchAllRows(() => sb.from('llm_call_log')
        .select('route, ok, created_at').neq('route', DAILY_SUMMARY_ROUTE).gte('created_at', since).order('created_at'))),
      must('webhook_events', fetchAllRows(() => sb.from('webhook_events')
        .select('delivery_status').gte('created_at', since).order('created_at'))),
      must('metrics_rollup_runs', sb.from('metrics_rollup_runs').select('ok, finished_at').order('started_at', { ascending: false }).limit(5)),
    ]);
    // External shops only for delivery, as in Insights: test shops' sends don't count.
    const internalIds = new Set(internal.map(b => b.id));
    const extMessages = recentMessages.filter(m => !internalIds.has(m.business_id));
    const checks = platformHealth({ now, recentMessages: extMessages, llmRecent, webhooks, runs });
    return NextResponse.json({ checks, computed_at: new Date(now).toISOString() }, { headers: NO_STORE });
  } catch (e) {
    console.error('[admin/health] failed:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500, headers: NO_STORE });
  }
}
