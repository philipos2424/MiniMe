/**
 * GET /api/public/search-count — public "N people searched MiniMe" counter.
 *
 * Powers the social-proof line on the directory page, the Market Mini App
 * header and the search bot's welcome message. Counts search_logs rows in the
 * trailing 30 days across every surface (bot + web + Market). Heavily cached —
 * it's hit by every visitor — so an exact count over a growing table is fine.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  let count = 0;
  try {
    const { count: c, error } = await supabase()
      .from('search_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since30);
    if (error) throw new Error(error.message);
    count = c || 0;
  } catch (e) {
    console.warn('[public/search-count]', e.message);
  }
  return NextResponse.json({ count }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  });
}
