/**
 * GET /api/cron/b2b-expire — daily sweep marking pending/delivered B2B messages
 * older than 7 days as `expired` so senders aren't left in limbo.
 *
 * Scheduled via vercel.json.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authed = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const sb = supabase();
  const { data, error } = await sb
    .from('business_messages')
    .update({ status: 'expired' })
    .in('status', ['pending', 'delivered'])
    .lt('created_at', cutoff)
    .select('id');

  if (error) {
    console.error('[b2b-expire]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expired: data?.length || 0 });
}
