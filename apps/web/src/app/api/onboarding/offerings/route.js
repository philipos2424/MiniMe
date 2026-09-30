/**
 * POST /api/onboarding/offerings
 *
 * A tap-first picker generated from the business NAME (+ category anchor).
 * The owner chooses offers and a single common Q&A pair; no first-run typing.
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
const GENERIC_OFFERINGS = ['Products', 'Services', 'Custom orders'];

const NAME_HINTS = [
  { terms:['phone', 'mobile', 'tech', 'electronic', 'computer'], offers:['Phone repairs', 'Device accessories', 'Chargers', 'Screen repairs', 'Device advice'] },
  { terms:['salon', 'beauty', 'spa', 'barber', 'hair'], offers:['Hair styling', 'Haircuts', 'Beauty services', 'Appointments', 'Product advice'] },
  { terms:['cafe', 'coffee', 'restaurant', 'kitchen', 'grill', 'pizza', 'bakery', 'mango'], offers:['Meals', 'Drinks', 'Takeaway', 'Fresh options', 'Order help'] },
  { terms:['fashion', 'boutique', 'wear', 'style', 'clothing'], offers:['Clothing', 'Accessories', 'New arrivals', 'Custom orders', 'Style advice'] },
  { terms:['repair', 'garage', 'auto', 'car'], offers:['Repairs', 'Parts', 'Service bookings', 'Maintenance', 'Repair advice'] },
];

function categoryFallback(category) {
  if (!category) return GENERIC_OFFERINGS;
  const tmpl = getCategoryTemplate(category);
  const baseKey = Object.keys(FALLBACK_OFFERINGS).find(k => getCategoryTemplate(k) === tmpl);
  return (baseKey && FALLBACK_OFFERINGS[baseKey]) || GENERIC_OFFERINGS;
}

function nameFallback(name, category) {
  const normalized = String(name || '').toLowerCase();
  const match = NAME_HINTS.find(({ terms }) => terms.some(term => normalized.includes(term)));
  return match ? match.offers : categoryFallback(category);
}

function questionFallback(selectedOfferings, answeredQuestions = []) {
  const offer = selectedOfferings[0] || 'this';
  const lowerOffer = offer.toLowerCase();
  return [
    { question: `Do you have ${lowerOffer} available?`, answers:["Tell us what you need and we'll check the current options.", "Message us with what you're looking for and we'll confirm."] },
    { question: `How much are your ${lowerOffer}?`, answers:["Tell us the option you have in mind and we'll share the current price.", "Message us the item you're interested in for today's price."] },
    { question: `Can you help me choose ${lowerOffer}?`, answers:[`Yes - tell us what you need and we'll help you choose the right ${lowerOffer}.`, "Send us a few details and we'll recommend an option."] },
    { question: `How do I get ${lowerOffer}?`, answers:["Tell us what you need and we'll guide you through the next step.", "Send us the details and we'll help you get started."] },
    { question: `Can I ask about ${lowerOffer}?`, answers:["Yes - tell us what you need and we'll help.", "Of course. Send us your question and we'll reply."] },
  ].filter(item => !answeredQuestions.includes(item.question));
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

  let body = {};
  try { body = await request.json(); } catch {}
  const selectedOfferings = Array.isArray(body.selected_offerings)
    ? [...new Set(body.selected_offerings.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 40)).filter(Boolean))].slice(0, 8)
    : [];
  const answeredQuestions = Array.isArray(body.answered_questions)
    ? [...new Set(body.answered_questions.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 120)).filter(Boolean))].slice(-5)
    : [];

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
  let questions = [];
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
          content: `You create a no-typing business setup picker for a global small business owner. Given the business NAME (the strongest signal), category, and selected offers, return JSON:
{"offerings":["..."],"questions":[{"question":"...","answers":["...","..."]}]}

Offerings: 8-12 short concrete product/service labels, each at most four words. Infer from the name, but use category if available. No emoji, prices, brand claims, delivery promises, or full sentences.

Questions: when selected offers are supplied, return exactly 5 different common customer questions and exactly 2 short answer choices per question. Make questions specific to the business name, category, and selected offers. For example, a salon should get booking or service questions; a repair shop should get repair or device questions; a food business should get menu or order questions. Use "What do you offer?" only when the business is truly ambiguous. Every answer must be safe and supported solely by the selected offers. Do not invent prices, availability, locations, delivery, warranty, hours, times, or policies. Prefer answers such as "We offer [selected offer]" or "Message us to confirm current options." If selected offers are empty, return questions as an empty array.`,
        },
        {
          role: 'user',
          content: `Business name: ${business.name || '(unnamed)'}\nCategory: ${business.category || 'unknown'}\nExisting products: ${productNames.length ? productNames.join(', ') : '(none yet)'}\nSelected offers: ${selectedOfferings.length ? selectedOfferings.join(', ') : '(none yet)'}\nAlready answered (do not repeat): ${answeredQuestions.length ? answeredQuestions.join(' | ') : '(none yet)'}`,
        },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    offerings = Array.isArray(raw.offerings)
      ? [...new Set(raw.offerings.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 30)))].slice(0, 14)
      : [];
    questions = Array.isArray(raw.questions)
      ? raw.questions.map(item => ({
          question: typeof item?.question === 'string' ? item.question.trim().slice(0, 120) : '',
          answers: Array.isArray(item?.answers) ? [...new Set(item.answers.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim().slice(0, 160)))].slice(0, 2) : [],
        })).filter(item => item.question && item.answers.length >= 2 && !answeredQuestions.includes(item.question)).slice(0, 5)
      : [];
  } catch (e) {
    console.warn('[onboarding/offerings] LLM failed, using fallback:', e.message);
  }

  if (!offerings.length) offerings = nameFallback(business.name, business.category);
  if (selectedOfferings.length && !questions.length) {
    questions = questionFallback(selectedOfferings, answeredQuestions);
  }

  return NextResponse.json({ offerings, questions });
}
