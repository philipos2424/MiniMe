/**
 * GET /api/cron/self-improve
 * Runs weekly (Monday 4am UTC = 7am Addis).
 *
 * For each business:
 *  1. Reads the past week's conversations
 *  2. Identifies patterns: owner corrections, bad feedback, repeated questions
 *  3. Asks GPT: "What should I improve based on this evidence?"
 *  4. IMPLEMENTS the suggestions: adds rules, embeds knowledge, updates sample replies
 *  5. Sends the owner a plain-language "here's what I learned this week" summary
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { selfImproveForBusiness } from '../../../../lib/server/selfImprove';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const authed =
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, category, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, shop_code, onboarding_completed, owner_instructions, sample_replies, subscription_status, trial_ends_at')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)')
    .not('owner_telegram_id', 'is', null);

  const summary = [];

  for (const b of businesses || []) {
    // Skip expired/cancelled businesses
    const status = b.subscription_status || 'trial';
    const trialOver = status === 'trial' && b.trial_ends_at && new Date(b.trial_ends_at) < new Date();
    if (status === 'cancelled' || (trialOver && status !== 'active')) {
      summary.push({ business: b.name, skipped: true, reason: 'expired' });
      continue;
    }

    let botToken;
    if (b.telegram_bot_token_enc) {
      try { botToken = decrypt(b.telegram_bot_token_enc); }
      catch { summary.push({ business: b.name, error: 'decrypt failed' }); continue; }
    } else {
      if (!AGENT_TOKEN) { summary.push({ business: b.name, skipped: true, reason: 'no_token' }); continue; }
      botToken = AGENT_TOKEN;
    }

    try {
      const result = await selfImproveForBusiness(b, botToken);
      summary.push({ business: b.name, ...result });
    } catch (e) {
      summary.push({ business: b.name, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), summary });
}
