/**
 * GET /api/admin/audit?days=30&actor_type=platform_admin&action=&business_id=&q=
 *
 * Platform-wide audit trail.
 *
 * audit_logs is written on every sensitive action — impersonation start/end,
 * tenant edits, customer erasure, bulk trial activation — and the only reader
 * was the per-business page at /settings/audit, which an owner sees for their
 * own shop. There was no way for the platform admin to answer "what did admin
 * #420769631 do last week", or "who touched this merchant", which is the
 * question every incident and every enterprise security questionnaire asks.
 *
 * Read-only by construction: this route only ever SELECTs. audit_logs has no
 * update/delete path in the app, and the table is RLS-enabled with no write
 * policy — every insert goes through the service-role client in lib/server/audit.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Actions that change tenant state or expose customer data. Everything here
// gets flagged in the UI — not because it's wrong, but because it's the set
// you want to be able to account for after the fact.
const SENSITIVE = new Set([
  'admin.impersonate_started',
  'admin.impersonate_ended',
  'customer.erased',
  'business.deleted',
  'business.subscription_changed',
  'business.bulk_trial_activated',
]);

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 90);
  const actorType = url.searchParams.get('actor_type') || '';
  const action = url.searchParams.get('action') || '';
  const businessId = url.searchParams.get('business_id') || '';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sb = supabase();

  const { data: logs, error } = await fetchAllRows(() => {
    let query = sb.from('audit_logs')
      .select('id, business_id, actor_type, actor_id, action, resource_type, resource_id, metadata, ip, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    if (actorType) query = query.eq('actor_type', actorType);
    if (action) query = query.eq('action', action);
    if (businessId) query = query.eq('business_id', businessId);
    return query;
  });

  if (error) {
    return NextResponse.json({
      ok: false,
      error: error.message,
      hint: 'audit_logs table missing? apply supabase/migrations/20260516_audit_logs.sql',
    }, { status: 500 });
  }

  let rows = logs || [];
  // Free-text filter applied in JS so it can span action + resource + actor
  // without needing a tsvector column on an append-only table.
  if (q) {
    rows = rows.filter(r =>
      (r.action || '').toLowerCase().includes(q) ||
      (r.actor_id || '').toLowerCase().includes(q) ||
      (r.resource_type || '').toLowerCase().includes(q) ||
      JSON.stringify(r.metadata || {}).toLowerCase().includes(q));
  }

  // ── Rollups ────────────────────────────────────────────────────────────────
  const byAction = {};
  const byActor = new Map();
  for (const r of rows) {
    byAction[r.action] = (byAction[r.action] || 0) + 1;
    const key = `${r.actor_type}:${r.actor_id}`;
    if (!byActor.has(key)) byActor.set(key, { actor_type: r.actor_type, actor_id: r.actor_id, count: 0, sensitive: 0, last_at: null, businesses: new Set() });
    const a = byActor.get(key);
    a.count++;
    if (SENSITIVE.has(r.action)) a.sensitive++;
    if (!a.last_at || r.created_at > a.last_at) a.last_at = r.created_at;
    if (r.business_id) a.businesses.add(r.business_id);
  }

  const bizIds = [...new Set(rows.map(r => r.business_id).filter(Boolean))];
  let nameMap = {};
  for (let i = 0; i < bizIds.length; i += 500) {
    const { data: bizRows } = await sb.from('businesses').select('id, name').in('id', bizIds.slice(i, i + 500));
    for (const b of bizRows || []) nameMap[b.id] = b.name;
  }

  const actors = [...byActor.values()]
    .map(a => ({ ...a, business_count: a.businesses.size, businesses: undefined }))
    .sort((a, b) => b.sensitive - a.sensitive || b.count - a.count);

  const buckets = Object.fromEntries(lastNDaysEAT(days).map(d => [d, 0]));
  for (const r of rows) {
    const k = dayKeyEAT(r.created_at);
    if (k in buckets) buckets[k]++;
  }

  // ── Impersonation sessions: pair start→end so an unclosed session is visible ──
  // A start with no matching end means an admin's access window was never
  // explicitly closed (it still expires on its own, max 120 min — but you
  // want to see the pattern).
  const impersonations = [];
  const openByAdmin = new Map();
  for (const r of rows) {
    if (r.action === 'admin.impersonate_started') {
      const key = `${r.actor_id}:${r.business_id}`;
      openByAdmin.set(key, r);
    } else if (r.action === 'admin.impersonate_ended') {
      const key = `${r.actor_id}:${r.business_id}`;
      const start = openByAdmin.get(key);
      if (start) {
        impersonations.push({
          admin_id: r.actor_id,
          business_id: r.business_id,
          business_name: nameMap[r.business_id] || '(deleted business)',
          started_at: start.created_at,
          ended_at: r.created_at,
          duration_mins: Math.round((new Date(r.created_at) - new Date(start.created_at)) / 60000),
          closed: true,
        });
        openByAdmin.delete(key);
      }
    }
  }
  for (const [, start] of openByAdmin) {
    impersonations.push({
      admin_id: start.actor_id,
      business_id: start.business_id,
      business_name: nameMap[start.business_id] || '(deleted business)',
      started_at: start.created_at,
      ended_at: null,
      duration_mins: null,
      closed: false,
    });
  }
  impersonations.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  return NextResponse.json({
    ok: true,
    period_days: days,
    totals: {
      entries: rows.length,
      sensitive: rows.filter(r => SENSITIVE.has(r.action)).length,
      distinct_actors: byActor.size,
      distinct_businesses: bizIds.length,
      impersonations: impersonations.length,
      impersonations_unclosed: impersonations.filter(i => !i.closed).length,
    },
    by_action: Object.entries(byAction).sort((a, b) => b[1] - a[1]).map(([action, count]) => ({ action, count, sensitive: SENSITIVE.has(action) })),
    actors,
    impersonations: impersonations.slice(0, 50),
    trend: Object.entries(buckets).map(([date, count]) => ({ date, count })),
    // Newest first — the raw tape.
    entries: rows.slice(-200).reverse().map(r => ({
      id: r.id,
      at: r.created_at,
      actor_type: r.actor_type,
      actor_id: r.actor_id,
      action: r.action,
      sensitive: SENSITIVE.has(r.action),
      business_id: r.business_id,
      business_name: r.business_id ? (nameMap[r.business_id] || '(deleted business)') : null,
      resource: r.resource_type ? `${r.resource_type}:${(r.resource_id || '').slice(0, 8)}` : null,
      ip: r.ip || null,
      metadata: r.metadata || null,
    })),
  });
}
