/**
 * GET /api/payment/methods
 *
 * Which payment rails are configured and therefore offerable. The upgrade UI
 * used to render Stripe, PayPal, Chapa, Telebirr and CBE unconditionally — so
 * an owner could pick a method that doesn't exist yet, and (before the guard in
 * ../subscribe/route.js) be granted Pro for free by its unconfigured fallback.
 *
 * Booleans only: no keys, no account numbers. The actual payment details are
 * returned by /api/payment/subscribe once a method is chosen.
 */
import { NextResponse } from 'next/server';
import { availableRails } from '../subscribe/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const rails = await availableRails();
  return NextResponse.json(
    { rails, any: Object.values(rails).some(Boolean) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
