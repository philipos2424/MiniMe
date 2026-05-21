/**
 * GET /api/analytics/top-questions
 *
 * Analyses recent inbound customer messages and returns the most common
 * question topics, so owners know what to add to their knowledge base.
 *
 * Auth: Telegram initData header.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { loggedCompletion } from '../../../../lib/server/openai-wrapper';
import { MODEL_MINI } from '../../../../lib/server/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sb = supabase();

  // Fetch last 200 inbound customer messages (last 30 days)
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: messages } = await sb
    .from('messages')
    .select('content, created_at')
    .eq('business_id', business.id)
    .eq('direction', 'inbound')
    .eq('content_type', 'text')
    .gte('created_at', since30)
    .not('content', 'ilike', '[%') // skip system messages
    .order('created_at', { ascending: false })
    .limit(200);

  if (!messages?.length) {
    return NextResponse.json({ topics: [], message_count: 0 });
  }

  // Cluster questions using GPT
  const sample = messages
    .map(m => m.content?.trim())
    .filter(t => t && t.length > 5 && t.length < 300)
    .slice(0, 100)
    .join('\n');

  try {
    const res = await loggedCompletion({
      route: 'analytics_questions',
      model: MODEL_MINI,
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You analyze customer messages to an Ethiopian business and identify the top question topics.
Return JSON with a "topics" array of up to 8 objects, each with:
- topic: short label (e.g. "Pricing", "Delivery", "Stock availability")
- count: estimated number of messages about this topic
- example: a short representative example from the messages
- suggestion: one-sentence suggestion for what to add to the knowledge base

Sort by count descending. Only include genuine questions/requests (not greetings).`,
        },
        {
          role: 'user',
          content: `Analyze these ${messages.length} customer messages:\n\n${sample}`,
        },
      ],
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    return NextResponse.json({
      topics: parsed.topics || [],
      message_count: messages.length,
      analysed: Math.min(messages.length, 100),
    });
  } catch (e) {
    console.warn('[top-questions]', e.message);
    return NextResponse.json({ topics: [], message_count: messages.length, error: 'analysis_failed' });
  }
}
