/**
 * GET /api/admin/businesses/:id/insights — the same per-business search &
 * market analytics the owner sees in Settings → MiniMe Search, admin-gated
 * and readable for any tenant. Shares lib/server/searchInsights.js with the
 * owner-facing route so the two never drift apart.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../../lib/server/admin';
import { supabase } from '../../../../../../lib/server/db';
import { buildSearchInsights } from '../../../../../../lib/server/searchInsights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30', 10) || 30));

  const sb = supabase();
  const { data: business } = await sb.from('businesses').select('id, category').eq('id', params.id).maybeSingle();
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const insights = await buildSearchInsights(business, { days });
  return NextResponse.json(insights);
}
