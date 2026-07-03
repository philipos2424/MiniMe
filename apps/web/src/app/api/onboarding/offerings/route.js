/**
 * POST /api/onboarding/offerings
 *
 * The Spotify-style turn-0 picker: generate 10–14 tappable offering chips FROM
 * THE BUSINESS NAME (+ category anchor), so a shop called "Cars" sees
 * "Used cars / Car rental / Spare parts…" — never another vertical's canned
 * list. The owner multi-selects and the client composes one natural sentence
 * for Selam; the normal interview pipeline does the teaching.
 *
 * Fallback chain (never blank, never blocks the chat): LLM → per-category
 * canned chips (moved here from the interview route, its only consumer now) →
 * three generic chips.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { loggedCompletion } from '../../../../lib/server/openai-wrapper';
import { MODEL_MINI } from '../../../../lib/server/constants';
import { getCategoryTemplate } from '../../../../lib/server/categoryTemplates';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Canned per-category chips — the FALLBACK only (previously the interview
// route's turn-0 OPENER_SUGGESTIONS; moved here when the LLM picker replaced
// them as the primary source).
const FALLBACK_OFFERINGS = {
  food:        ['Traditional dishes', 'Fasting food', 'Delivery', 'Takeaway', 'Fresh juices', 'Burgers', 'Catering'],
  fashion:     ['Habesha dresses', 'Modern wear', 'Bags', 'Shoes', 'Accessories', 'Custom tailoring'],
  beauty:      ['Hair styling', 'Nails', 'Facials', 'Bridal makeup', 'Walk-ins welcome', 'Appointments'],
  electronics: ['Phones', 'Laptops', 'New and used', 'Repairs', 'Accessories', 'Chargers'],
  grocery:     ['Fresh produce', 'Daily essentials', 'Bulk orders', 'Delivery in Addis', 'Wholesale prices'],
  services:    ['Design work', 'Printing', 'Consulting', 'Training', 'Custom projects'],
  crafts:      ['Handmade leather goods', 'Custom orders', 'Traditional crafts', 'Gifts'],
};
const GENERIC_OFFERINGS = ['What we sell', 'Services we offer', 'We take custom orders'];

function categoryFallback(category) {
  if (!category) return GENERIC_OFFERINGS;
  const tmpl = getCategoryTemplate(category);
  const baseKey = Object.keys(FALLBACK_OFFERINGS).find(k => getCategoryTemplate(k) === tmpl);
  return (baseKey && FALLBACK_OFFERINGS[baseKey]) || GENERIC_OFFERINGS;
}

export async function POST(request) {
  // One LLM call per press; a handful per signup is plenty.
  const { ok: rl, retryAfter } = rateLimit(getIP(request), 'onboarding_offerings', 10, 60);
  if (!rl) return NextResponse.json({ error: 'too_many_requests', retryAfter }, { status: 429 });

  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const business = await findByOwnerTelegramId(tg.id);
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });

  // Existing products give the model concrete anchors and avoid duplicates.
  let productNames = [];
  try {
    const { data } = await supabase()
      .from('products').select('name')
      .eq('business_id', business.id).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(5);
    productNames = (data || []).map(p => (p.name || '').trim()).filter(Boolean);
  } catch { /* fine — name+category alone still work */ }

  let offerings = [];
  try {
    const res = await loggedCompletion({
      route: 'onboarding_offerings',
      business_id: business.id,
      model: MODEL_MINI,
      temperature: 0.6,
      max_tokens: 260,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You generate tappable onboarding chips for an Ethiopian small business. Given the business NAME (the strongest signal — infer what a shop with this name sells/does) and category, return JSON {"offerings": ["...", ...]} with 10-14 SHORT chips (each ≤ 4 words) of concrete things this business plausibly sells or does. Think like the owner listing their real offerings: product types, popular brands/items for that vertical, common services (delivery, custom orders) — for the Ethiopian market. No prices. No sentences. No emoji. No duplicates of the existing products listed. If the name is ambiguous, lean on the category.`,
        },
        {
          role: 'user',
          content: `Business name: ${business.name || '(unnamed)'}\nCategory: ${business.category || 'unknown'}\nExisting products: ${productNames.length ? productNames.join(', ') : '(none yet)'}`,
        },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    offerings = Array.isArray(raw.offerings)
      ? [...new Set(raw.offerings.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 30)))].slice(0, 14)
      : [];
  } catch (e) {
    console.warn('[onboarding/offerings] LLM failed, using fallback:', e.message);
  }

  if (!offerings.length) offerings = categoryFallback(business.category);

  return NextResponse.json({ offerings });
}
