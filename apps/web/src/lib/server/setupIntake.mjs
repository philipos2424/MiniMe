/**
 * One-message setup (pure, no I/O).
 *
 * The setup guide asked one thing at a time: shop or Secretary, then each
 * product, then hours, then location, then delivery, then payment. That is a
 * form, just sent as chat messages. Instead the owner gets one open question:
 *
 *   "Tell me about your business — what you sell and prices, where you are,
 *    your hours. Or send a photo of your price list."
 *
 * The AI reads the answer (and the photo, through the vision description),
 * works out what MiniMe is for, fills the catalog and the basics, shows a
 * live "setting up…" message, and then a summary card with what it got. Only
 * what's missing is asked afterwards (usually the payment number). The
 * step-by-step guide stays as the fallback and for fixes.
 */
import { validateNewProduct } from './ownerTeach.mjs';
import { normalizeEtPhone, normalizeCbeAccount, mdEscape } from './setupGuide.mjs';

export const INTAKE_CATEGORIES = [
  'food_beverage', 'clothing_fashion', 'beauty_wellness', 'electronics_phones', 'training_consulting',
  'it_tech', 'photography_video', 'catering_food', 'branding_design', 'printing_signage',
  'events_entertainment', 'construction_interior', 'transport_delivery', 'wholesale_supply',
  'vehicles_automotive', 'other',
];

export const MAX_INTAKE_PRODUCTS = 40;

export function intakeQuestion(ownerFirst = '') {
  return [
    `👋 *${ownerFirst ? `Hi ${ownerFirst}! ` : ''}Tell me about your business in one message.*`,
    '',
    'What you sell and the prices, where you are, when you\'re open, and if you deliver. Like:',
    '_"I sell shoes in Merkato. Nike Air 3500, sandals 900. Open Mon–Sat 9–7. Delivery in Addis 150 birr."_',
    '',
    '📸 Or send a *photo of your price list or menu*.',
    '',
    'Just want me to answer *your own* Telegram (friends, family, clients)? Tap below.',
  ].join('\n');
}

export function intakeKeyboard() {
  return { inline_keyboard: [
    [{ text: '📱 Answer my own Telegram', callback_data: 'setup_track_secretary' }],
    [{ text: '📋 Set up step by step instead', callback_data: 'setup_track_shop' }],
  ] };
}

export const INTAKE_SYSTEM = `You set up an AI sales assistant for a small business in Ethiopia. The owner described their business in one message (Amharic, English or both), sometimes with a photo of a price list (described for you). Return ONLY JSON:
{
  "track": "shop" | "secretary",          // "secretary" only if they mainly want replies to their personal Telegram and sell nothing specific
  "business_name": string|null,            // only if they state it
  "category": one of ${INTAKE_CATEGORIES.join('|')},
  "about": string|null,                    // one plain sentence: what the business is
  "products": [{"name": string, "price": number|null, "stock": number|null}],   // every item with its price in ETB; no invented items or prices
  "hours": string|null,                    // e.g. "Mon–Sat 9am–7pm"
  "location": string|null,                 // e.g. "Merkato, Addis Ababa"
  "delivery": string|null,                 // e.g. "Delivery in Addis, 150 birr" or "No delivery, pickup only"
  "telebirr": string|null,                 // a Telebirr/phone number they say customers pay to
  "cbe": string|null,                      // a CBE account number
  "facts": [string]                        // other things customers would ask (warranty, sizes, returns) — short, max 6
}
Rules: never invent anything they didn't say or show. Use null or [] when unknown. Prices are numbers (3500, not "3,500 birr"). Keep product names as they wrote them.`;

const clean = (v, max = 200) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s && !/^(null|none|n\/a|unknown|-)$/i.test(s) ? s.slice(0, max) : null;
};

/** Parse and validate what the AI returned. Never throws. */
export function normalizeIntake(raw) {
  let o = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    try { o = JSON.parse(m ? m[0] : raw); } catch { o = {}; }
  }
  if (!o || typeof o !== 'object') o = {};
  const seen = new Set();
  const products = [];
  const unpriced = [];
  for (const p of Array.isArray(o.products) ? o.products : []) {
    if (products.length >= MAX_INTAKE_PRODUCTS) break;
    const price = typeof p?.price === 'string' ? Number(p.price.replace(/[^\d.]/g, '')) || null : p?.price;
    const v = validateNewProduct({ name: clean(p?.name, 120), price, stock: p?.stock ?? undefined });
    if (!v.ok) {
      const n = clean(p?.name, 120);
      if (n && n.length >= 2 && unpriced.length < 10 && !unpriced.some(u => u.toLowerCase() === n.toLowerCase())) unpriced.push(n);
      continue;
    }
    const key = v.product.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(v.product);
  }
  const category = INTAKE_CATEGORIES.includes(o.category) ? o.category : null;
  return {
    track: o.track === 'secretary' && !products.length ? 'secretary' : 'shop',
    business_name: clean(o.business_name, 80),
    category,
    about: clean(o.about, 300),
    products,
    unpriced,
    hours: clean(o.hours),
    location: clean(o.location),
    delivery: clean(o.delivery),
    telebirr: o.telebirr ? normalizeEtPhone(String(o.telebirr)) : null,
    cbe: o.cbe ? normalizeCbeAccount(String(o.cbe)) : null,
    facts: (Array.isArray(o.facts) ? o.facts : []).map(f => clean(f, 300)).filter(Boolean).slice(0, 6),
  };
}

/** Did we get anything worth setting up from? */
export function intakeUseful(i) {
  return !!(i && (i.products.length || i.unpriced?.length || i.hours || i.location || i.delivery || i.about || i.telebirr || i.cbe || i.track === 'secretary'));
}

/**
 * The live "setting up…" message. stage: how many lines are finished.
 * Lines only for what we actually got, so it never claims work it didn't do.
 */
export function assemblyLines(i) {
  const lines = [];
  if (i.products.length) lines.push(`🛍️ ${i.products.length} product${i.products.length === 1 ? '' : 's'} added to your catalog`);
  if (i.location) lines.push(`📍 Location: ${i.location}`);
  if (i.hours) lines.push(`🕘 Hours: ${i.hours}`);
  if (i.delivery) lines.push(`🚚 Delivery: ${i.delivery}`);
  if (i.telebirr || i.cbe) lines.push(`💳 Payment: ${[i.telebirr && `Telebirr ${i.telebirr}`, i.cbe && `CBE ${i.cbe}`].filter(Boolean).join(' · ')}`);
  if (i.facts.length) lines.push(`🧠 ${i.facts.length} thing${i.facts.length === 1 ? '' : 's'} customers ask, remembered`);
  return lines;
}

export function assemblyText(i, stage) {
  const lines = assemblyLines(i);
  const done = Math.min(stage, lines.length);
  const body = lines.map((l, n) => (n < done ? `✅ ${l.replace(/^\S+\s/, '')}` : n === done ? `⏳ ${l.replace(/^\S+\s/, '')}…` : `▫️ ${l.replace(/^\S+\s/, '')}`));
  const head = done >= lines.length ? '✨ *Your MiniMe is set up*' : '⚙️ *Setting up your MiniMe…*';
  return [head, '', ...body.map(mdEscape)].join('\n');
}

/** What's still missing after the intake, most important first. */
export function intakeMissing(i, existing = {}) {
  const miss = [];
  if (!i.products.length && !(existing.productCount > 0)) miss.push('products');
  if (!i.telebirr && !i.cbe && !existing.hasPayment) miss.push('payments');
  if (!i.location && !existing.location) miss.push('location');
  if (!i.hours && !existing.hours) miss.push('hours');
  return miss;
}

const MISSING_LABEL = {
  products: 'what you sell and the prices',
  payments: 'your Telebirr number or CBE account, so I can send it with every order',
  location: 'where you are',
  hours: 'your opening hours',
};

/** The summary card after setup: what we got, a fix button, and what's next. */
export function intakeSummary(i, existing = {}) {
  const lines = ['✨ *Here\'s what I set up*', ''];
  if (i.about) lines.push(`_${mdEscape(i.about)}_`, '');
  if (i.products.length) {
    const shown = i.products.slice(0, 8).map(p => `• ${mdEscape(p.name)}${p.price != null ? ` — ${Number(p.price).toLocaleString('en-US')} ETB` : ''}`);
    lines.push(`🛍️ *${i.products.length} product${i.products.length === 1 ? '' : 's'}*`, ...shown);
    if (i.products.length > 8) lines.push(`…and ${i.products.length - 8} more`);
    lines.push('');
  }
  if (i.unpriced?.length) lines.push(`❓ No price yet for: ${i.unpriced.map(mdEscape).join(', ')} — tap Fix and tell me.`, '');
  for (const l of assemblyLines(i).filter(l => !l.startsWith('🛍️'))) lines.push(mdEscape(l));
  const miss = intakeMissing(i, existing);
  lines.push('');
  if (miss.length) lines.push(`*Still need:* ${miss.map(k => MISSING_LABEL[k]).join('; ')}.`);
  else lines.push('*That\'s everything I need.* See how I\'d answer a customer 👇');
  lines.push('', '_Something wrong? Tap Fix and just tell me, e.g. "sandals are 950" or "we\'re closed Sunday"._');
  return lines.join('\n');
}

export function intakeSummaryKeyboard(i, existing = {}) {
  const miss = intakeMissing(i, existing);
  const rows = [];
  if (miss.includes('payments')) rows.push([{ text: '💳 Add how customers pay', callback_data: 'setup_go_payments' }]);
  else if (miss.includes('products')) rows.push([{ text: '🛍️ Add what you sell', callback_data: 'setup_go_products' }]);
  rows.push([{ text: '👀 See how I answer a customer', callback_data: 'setup_run_preview' }]);
  rows.push([{ text: '✅ Looks right', callback_data: 'setup_open' }, { text: '✏️ Fix something', callback_data: 'setup_intake_fix' }]);
  return { inline_keyboard: rows };
}

/** Words for the AI when the owner is correcting an earlier intake. */
export function fixPrompt(text, previous) {
  const had = previous ? `\n\nWhat I set up before:\n${JSON.stringify(previous).slice(0, 2500)}` : '';
  return `The owner is CORRECTING or ADDING TO their setup. Return only what changes or is new (same JSON shape; leave the rest null/[]). A product with a new price goes in products with the new price.${had}\n\nOwner: ${text}`;
}
