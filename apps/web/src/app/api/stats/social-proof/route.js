/**
 * GET /api/stats/social-proof
 *
 * Live signup count for the paywall's proof badge. Aggregate only — no
 * per-business data — so it needs no auth, and nothing here identifies a shop.
 *
 * Returns { signups, replies } or { signups: null } when there isn't enough
 * activity to show honest proof (see lib/server/socialProof.js).
 *
 * Explicitly uncached at every layer: this is a live count and a CDN copy would
 * freeze it. The module behind it holds a 15s window purely to collapse burst
 * reads.
 */
import { NextResponse } from 'next/server';
import { getSocialProof, getPeerProof } from '../../../../lib/server/socialProof';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  // Optional: the viewer's own category/city, so we can show "shops like
  // yours, near you" instead of a national total. Aggregate counts only —
  // nothing here can identify a shop, so this needs no auth.
  const category = searchParams.get('category');
  const city = searchParams.get('city');

  const [proof, peers] = await Promise.all([
    getSocialProof(),
    (category || city) ? getPeerProof({ category, city }) : Promise.resolve(null),
  ]);

  return NextResponse.json(
    { ...(proof || { signups: null, replies: null }), peers },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
