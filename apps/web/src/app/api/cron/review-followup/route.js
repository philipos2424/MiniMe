/**
 * GET /api/cron/review-followup
 *
 * Daily cron (09:00 EAT): sends review requests to customers who
 * chatted with a business via MiniMe Search 24+ hours ago.
 *
 * Only asks customers who:
 *  - Arrived via MiniMe Search (search_referrals entry)
 *  - First messaged 24+ hours ago
 *  - Haven't already reviewed that business
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEARCH_BOT_TOKEN = process.env.SEARCH_BOT_TOKEN;

async function tg(method, body) {
  if (!SEARCH_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${SEARCH_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.warn('[review-followup] tg error:', e.message);
    return null;
  }
}

export async function GET(request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!SEARCH_BOT_TOKEN) {
    return NextResponse.json({ error: 'no_search_bot_token' }, { status: 500 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Find referrals from 24-48 hours ago (one-day window to avoid re-sending)
  const now = new Date();
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const until = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: referrals, error } = await sb
    .from('search_referrals')
    .select('id, business_id, customer_telegram_id, first_message_at')
    .gte('first_message_at', since)
    .lte('first_message_at', until)
    .eq('landed', true)
    .limit(50);

  if (error) {
    console.warn('[review-followup] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!referrals?.length) {
    return NextResponse.json({ ok: true, sent: 0, message: 'no eligible referrals' });
  }

  let sent = 0;
  let skipped = 0;

  for (const ref of referrals) {
    try {
      // Check if customer already reviewed this business
      const { data: existingReview } = await sb
        .from('reviews')
        .select('id')
        .eq('business_id', ref.business_id)
        .eq('reviewer_telegram_id', ref.customer_telegram_id)
        .limit(1);

      if (existingReview?.length) {
        skipped++;
        continue;
      }

      // Get business name for the message
      const { data: biz } = await sb
        .from('businesses')
        .select('name')
        .eq('id', ref.business_id)
        .single();

      if (!biz) continue;

      // Send review request via search bot
      const result = await tg('sendMessage', {
        chat_id: ref.customer_telegram_id,
        parse_mode: 'Markdown',
        text: `👋 You chatted with *${biz.name}* yesterday through MiniMe Search.\n\nHow was your experience?`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⭐', callback_data: `rv:${ref.business_id}:1` },
              { text: '⭐⭐', callback_data: `rv:${ref.business_id}:2` },
              { text: '⭐⭐⭐', callback_data: `rv:${ref.business_id}:3` },
              { text: '⭐⭐⭐⭐', callback_data: `rv:${ref.business_id}:4` },
              { text: '⭐⭐⭐⭐⭐', callback_data: `rv:${ref.business_id}:5` },
            ],
          ],
        },
      });

      if (result?.ok) sent++;
    } catch (e) {
      console.warn('[review-followup] send error:', e.message);
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    total_referrals: referrals.length,
  });
}
