/**
 * GET /api/stats — tiny public counter for honest social proof.
 *
 * Returns { live_shops } = how many businesses have finished onboarding and
 * gone live. No auth, no PII — just an aggregate count the onboarding UI shows
 * ("Join N Ethiopian shops already live") once it clears a threshold. Cached so
 * it never adds load: the number moving by a few is not time-sensitive.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let live_shops = 0;
  try {
    const { count } = await supabase()
      .from('businesses')
      .select('id', { count: 'exact', head: true })
      .eq('onboarding_completed', true);
    live_shops = count || 0;
  } catch (e) {
    console.warn('[stats] count failed:', e.message);
  }
  return NextResponse.json(
    { live_shops },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
