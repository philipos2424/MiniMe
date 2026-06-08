/**
 * GET /api/analytics/insights?days=7
 *
 * Returns AI-generated insights about what customers are asking,
 * what's working, and what's missing.
 *
 * Uses GPT-4.1-mini to analyze a sample of recent inbound messages
 * and produce actionable insights without exposing PII.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get('days') || '7', 10), 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const sb = supabase();

  // Fetch inbound messages (content only, no customer PII)
  const { data: msgs } = await sb.from('messages')
    .select('content, created_at')
    .eq('business_id', business.id)
    .eq('direction', 'inbound')
    .gte('created_at', since)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(150);

  if (!msgs?.length || msgs.length < 5) {
    return NextResponse.json({
      insights: null,
      message: 'Not enough messages yet to generate insights. Check back after more customers message your bot.',
      message_count: msgs?.length || 0,
    });
  }

  // Strip any PII-like patterns from message content before sending to OpenAI
  const cleanMsgs = msgs.map(m => ({
    text: (m.content || '').replace(/\+?[0-9]{7,15}/g, '[phone]').replace(/\b[\w.]+@[\w.]+\b/g, '[email]').slice(0, 200),
    date: m.created_at.slice(0, 10),
  }));

  const sampleText = cleanMsgs.slice(0, 80).map(m => `• ${m.text}`).join('\n');

  // Fetch products for context
  const { data: products } = await sb.from('products')
    .select('name, price, currency, stock_quantity')
    .eq('business_id', business.id)
    .eq('is_active', true)
    .limit(20);

  const catalogText = products?.length
    ? products.map(p => `${p.name} (${p.price || 'no price'} ${p.currency || 'ETB'})`).join(', ')
    : 'No products in catalog';

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: `You are a business analyst for "${business.name}" (${business.category || 'business'} in Ethiopia). Analyze customer messages and return JSON insights. Be specific and actionable.`,
      }, {
        role: 'user',
        content: `Analyze these ${cleanMsgs.length} customer messages from the last ${days} days:

${sampleText}

Current catalog: ${catalogText}

Return JSON with this structure:
{
  "top_requests": ["3-5 most common things customers ask about or want"],
  "missing_from_catalog": ["items customers requested that aren't in the catalog"],
  "frequently_asked": ["top 3 questions customers keep asking"],
  "opportunity": "One concrete business opportunity based on customer demand",
  "action_items": ["2-3 specific things the owner should do this week"],
  "summary": "2 sentence summary of what customers want most"
}

Be specific — mention actual product names, services, or topics from the messages. Keep each item under 80 chars.`,
      }],
    });

    const insights = JSON.parse(res.choices[0].message.content);
    return NextResponse.json({
      insights,
      message_count: msgs.length,
      days,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message, insights: null }, { status: 500 });
  }
}
