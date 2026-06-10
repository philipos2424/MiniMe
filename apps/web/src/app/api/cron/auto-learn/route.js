/**
 * GET /api/cron/auto-learn — daily auto-learning across all businesses.
 * Runs at 03:00 UTC (06:00 Addis) before the 09:00 Addis follow-ups cron.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { mineConversationsForBusiness, detectAndNotifyKnowledgeGaps } from '../../../../lib/server/autoLearn';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const authed =
    isCronAuthorized(request);
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, telegram_bot_token_enc, shop_code, onboarding_completed, owner_private_chat_id, owner_telegram_id')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)');

  const summary = [];
  for (const b of businesses || []) {
    try {
      const r = await mineConversationsForBusiness(b);
      summary.push({ business: b.name, ...r });

      // Once a week (Monday) detect knowledge gaps and notify owner
      if (new Date().getDay() === 1) {
        let botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (b.telegram_bot_token_enc) {
          try { botToken = decrypt(b.telegram_bot_token_enc); } catch {}
        }
        await detectAndNotifyKnowledgeGaps(b, botToken).catch(e =>
          console.warn('[auto-learn] gap detection failed for', b.name, e.message)
        );
      }
    } catch (e) {
      summary.push({ business: b.name, error: e.message });
    }
  }
  return NextResponse.json({ ok: true, summary });
}
