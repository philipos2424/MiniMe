/**
 * GET /api/cron/extract-owner-facts — daily extraction of durable owner
 * preferences from recent owner-bot conversation history. Stored in
 * businesses.notification_prefs.owner_facts so the owner bot can recall
 * them in every future prompt.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { extractAndSaveOwnerFacts } from '../../../../lib/server/ownerMemory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const authed = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  // Only run for businesses that have actually been used (have owner_chat history)
  const { data: businesses } = await sb
    .from('businesses')
    .select('id, name, notification_prefs, shop_code, onboarding_completed')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)')
    .limit(500);

  const eligible = (businesses || []).filter(b => {
    const turns = b.notification_prefs?.owner_chat || [];
    return turns.length >= 4;
  });

  const results = [];
  for (const biz of eligible) {
    try {
      const r = await extractAndSaveOwnerFacts(biz.id);
      results.push({ id: biz.id, name: biz.name, ...r });
    } catch (e) {
      console.error('[extract-owner-facts]', biz.id, e.message);
      results.push({ id: biz.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    facts_added: results.reduce((s, r) => s + (r.added || 0), 0),
  });
}
