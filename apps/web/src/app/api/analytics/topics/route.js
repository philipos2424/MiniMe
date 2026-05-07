/**
 * GET /api/analytics/topics
 * Returns the top detected topics + intents from inbound messages in the last 30 days.
 * Uses messages.detected_topics (TEXT[]) and messages.detected_intent (VARCHAR).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: msgs } = await sb
    .from('messages')
    .select('detected_intent, detected_topics')
    .eq('business_id', business.id)
    .eq('direction', 'inbound')
    .gte('created_at', since)
    .not('detected_intent', 'is', null)
    .limit(2000);

  if (!msgs?.length) {
    return NextResponse.json({ topics: [], intents: [] });
  }

  // Aggregate topics
  const topicCount = {};
  const intentCount = {};

  for (const m of msgs) {
    if (m.detected_intent) {
      intentCount[m.detected_intent] = (intentCount[m.detected_intent] || 0) + 1;
    }
    for (const t of m.detected_topics || []) {
      if (t) topicCount[t] = (topicCount[t] || 0) + 1;
    }
  }

  const topics = Object.entries(topicCount)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const intents = Object.entries(intentCount)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return NextResponse.json({ topics, intents, total: msgs.length });
}
