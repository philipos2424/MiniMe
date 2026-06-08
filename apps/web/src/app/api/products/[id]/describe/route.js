/**
 * POST /api/products/[id]/describe
 * Uses AI to generate a compelling product description based on the
 * product name, price, category, and business context.
 */
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { MODEL_MINI } from '../../../../../lib/server/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const { data: product } = await sb.from('products')
    .select('id, name, price, currency, name_am')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const lang = body.lang || 'english'; // 'english' | 'amharic' | 'mixed'

  const prompt = `Write a short, compelling product description for a small business in Ethiopia.

Business: ${business.name} (${business.category || 'retail'})
Product: ${product.name}${product.name_am ? ` / ${product.name_am}` : ''}
Price: ${product.price ? `${product.price} ${product.currency || 'ETB'}` : 'price not set'}
Language: ${lang === 'amharic' ? 'Amharic only' : lang === 'mixed' ? 'Mix Amharic and English naturally' : 'English'}

Requirements:
- Max 2 sentences, max 80 words
- Highlight key benefits or quality
- Warm and inviting tone
- No generic filler words
- If mixed/amharic, use natural Ethiopian speech patterns
- Do NOT include the price (shown separately)

Return only the description, nothing else.`;

  try {
    const res = await openai.chat.completions.create({
      model: MODEL_MINI,
      temperature: 0.7,
      max_tokens: 120,
      messages: [
        { role: 'system', content: 'You write concise, compelling product descriptions for Ethiopian small businesses.' },
        { role: 'user', content: prompt },
      ],
    });
    const description = res.choices[0]?.message?.content?.trim();
    if (!description) return NextResponse.json({ error: 'generation failed' }, { status: 500 });

    return NextResponse.json({ description });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
