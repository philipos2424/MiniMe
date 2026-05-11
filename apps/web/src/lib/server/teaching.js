/**
 * Teaching — lets the owner feed raw business knowledge into Alfred's brain.
 *
 * Two channels:
 *   1. Mini App "Teach Alfred" page → POST /api/teach with description / URLs.
 *   2. Telegram DM: the owner forwards a client message, or types a
 *      description after /teach → replyEngine routes it through here.
 *
 * What we store:
 *   - A plain-English narrative chunk in `documents` (tag='business-brief'
 *     or 'owner-knowledge') → embedded like any other KB doc so the agent
 *     brain + advisor retrieve from it automatically.
 *   - Structured extracts folded back onto the `businesses` row where
 *     possible (category, services, price range, etc.).
 *   - Forwarded-client facts → `customer_memory` entries tied to that
 *     customer if we can match them.
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { MODEL_MINI } from './constants';
import { translateToAmharic } from './hasab';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = 'text-embedding-3-small';

// ────────────────────────────── Extraction via GPT ──────────────────────────────
export async function extractBusinessFacts(text) {
  if (!text || text.length < 10) return null;
  const completion = await openai.chat.completions.create({
    model: MODEL_MINI,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You extract structured facts about a small business from the owner's own words. Return JSON with these keys (null if not mentioned):
{
  "category": string | null,          // e.g. "graphic design", "photography", "cafe"
  "location": string | null,
  "services": string[] | null,        // concrete offerings
  "specialties": string[] | null,     // niches / strengths
  "client_types": string[] | null,    // who they work with
  "price_range": { "min": number|null, "max": number|null, "currency": string|null } | null,
  "turnaround": string | null,        // e.g. "3-5 days", "same day"
  "tone": string | null,              // how they like to sound: warm, formal, playful
  "process": string | null,           // how jobs flow through their shop
  "dont_do": string[] | null,         // things they refuse / are not
  "notable_clients_or_work": string[] | null,
  "summary": string                   // 1-2 sentence plain-English summary
}
If the text clearly isn't about a business, return {"summary": "(not a business description)"}. Keep arrays short (max 6 items each).`,
      },
      { role: 'user', content: text.slice(0, 6000) },
    ],
  });
  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch {
    return null;
  }
}

export async function extractFromClientMessage(text, context = '') {
  if (!text || text.length < 5) return null;
  const completion = await openai.chat.completions.create({
    model: MODEL_MINI,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You extract useful facts about a CLIENT from a message or snippet their small-business owner forwarded to their AI assistant. Return JSON:
{
  "client_name": string | null,
  "sentiment": "happy" | "satisfied" | "neutral" | "concerned" | "unhappy" | null,
  "facts": string[],                 // atomic facts worth remembering (preferences, context, their company, their event, their budget, their timeline, their style, what they loved/hated). Each < 25 words.
  "project_type": string | null,
  "budget_hint": string | null,
  "deadline_hint": string | null,
  "summary": string                  // 1 sentence
}
Output only the JSON.`,
      },
      context ? { role: 'system', content: `Context: ${context}` } : null,
      { role: 'user', content: text.slice(0, 3000) },
    ].filter(Boolean),
  });
  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch {
    return null;
  }
}

// ────────────────────────────── Storage ──────────────────────────────
async function embedOne(text) {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
  return r.data[0].embedding;
}

function chunkText(text, size = 900, overlap = 120) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= size) return [clean];
  const out = [];
  for (let i = 0; i < clean.length; i += (size - overlap)) out.push(clean.slice(i, i + size));
  return out;
}

/**
 * Save a narrative chunk to the KB (embedded, retrievable) AND fold any
 * structured fields back onto the businesses row. Returns {doc_id, applied}.
 */
export async function saveBusinessBrief(businessId, { text, extracted, title = 'Owner brief', tag = 'business-brief' }) {
  const sb = supabase();

  // 1) Upsert a documents row with the narrative
  const { data: doc, error: docErr } = await sb.from('documents').insert({
    business_id: businessId,
    title,
    tag,
    description: text.slice(0, 400),
    mime_type: 'text/plain',
    original_filename: title,
    status: 'embedding',
    meta: { source: 'teaching', summary: extracted?.summary || null },
  }).select().single();
  if (docErr) return { ok: false, error: docErr.message };

  // 2) Chunk + embed
  const chunks = chunkText(text);
  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedOne(chunks[i]);
    rows.push({
      document_id: doc.id,
      business_id: businessId,
      chunk_index: i,
      content: chunks[i],
      token_count: Math.ceil(chunks[i].length / 4),
      embedding,
    });
  }
  if (rows.length) await sb.from('document_chunks').insert(rows);
  await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);

  // 3) Fold structured extracts onto businesses row (only if empty, never
  //    overwrite things the owner explicitly set elsewhere).
  const applied = {};
  if (extracted && typeof extracted === 'object') {
    const { data: biz } = await sb.from('businesses').select('category, description').eq('id', businessId).single();
    const updates = {};
    if (extracted.category && !biz?.category) { updates.category = extracted.category; applied.category = extracted.category; }
    if (extracted.summary && !biz?.description) { updates.description = extracted.summary; applied.description = extracted.summary; }
    if (Object.keys(updates).length) {
      await sb.from('businesses').update(updates).eq('id', businessId);
    }
  }

  return { ok: true, doc_id: doc.id, chunks: rows.length, applied };
}

/**
 * Save one or more facts about a specific customer to customer_memory.
 * If customerId is null, stashes them under a synthetic "inbox" so the
 * owner can match them later.
 */
export async function saveClientFacts(businessId, customerId, extracted) {
  if (!extracted || !Array.isArray(extracted.facts)) return { saved: 0 };
  const sb = supabase();
  const rows = extracted.facts.slice(0, 10).map(f => ({
    business_id: businessId,
    customer_id: customerId,
    kind: 'fact',
    content: String(f).slice(0, 400),
    source: 'forwarded',
  }));
  if (extracted.sentiment) {
    rows.push({
      business_id: businessId,
      customer_id: customerId,
      kind: 'note',
      content: `Last sentiment observed: ${extracted.sentiment}${extracted.summary ? ' — ' + extracted.summary : ''}`,
      source: 'forwarded',
    });
  }
  if (!rows.length) return { saved: 0 };
  // Drop any with null customer_id if the column is NOT NULL — we'll stash those into documents instead.
  const withCustomer = rows.filter(r => r.customer_id);
  const orphan = rows.filter(r => !r.customer_id);
  if (withCustomer.length) {
    await sb.from('customer_memory').insert(withCustomer);
  }
  if (orphan.length) {
    // Put orphan facts into a "forwarded-notes" document so they're still retrievable.
    const text = orphan.map(o => `- [${o.kind}] ${o.content}`).join('\n');
    const { data: doc } = await sb.from('documents').insert({
      business_id: businessId,
      title: `Forwarded client notes — ${new Date().toISOString().slice(0, 10)}`,
      tag: 'forwarded-notes',
      description: text.slice(0, 400),
      mime_type: 'text/plain',
      original_filename: 'forwarded-notes.txt',
      status: 'embedding',
      meta: { source: 'teaching-orphan' },
    }).select().single();
    if (doc) {
      const embedding = await embedOne(text);
      await sb.from('document_chunks').insert([{
        document_id: doc.id,
        business_id: businessId,
        chunk_index: 0,
        content: text,
        token_count: Math.ceil(text.length / 4),
        embedding,
      }]);
      await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);
    }
  }
  return { saved: rows.length };
}

/**
 * Extract product stock changes from a forwarded supplier/inventory message.
 * Returns an array of { product_query, delta, set_to, note } where:
 *  - delta = positive (added) or negative (sold/removed) integer
 *  - set_to = absolute count if message specifies "we now have X"
 * Either delta OR set_to will be present, not both.
 */
export async function extractStockChanges(text, catalog) {
  if (!text || !catalog?.length) return [];
  const completion = await openai.chat.completions.create({
    model: MODEL_MINI,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Extract product stock updates from a supplier/inventory message. Match to the CATALOG below. Return JSON: { "updates": [{"product_name": "<from catalog>", "delta": <signed int|null>, "set_to": <int|null>, "note": "<short>"}] }
- delta: positive when stock arrived/added, negative when sold/used. Null if message states absolute total.
- set_to: absolute total when message says "now we have X", "stock is X". Null otherwise.
- Skip products that aren't clearly mentioned. Return {"updates": []} if nothing matches.

CATALOG:
${catalog.map(p => `- ${p.name}${p.name_am ? ' / ' + p.name_am : ''} (current stock: ${p.stock_quantity ?? '?'})`).join('\n')}`,
      },
      { role: 'user', content: text.slice(0, 2000) },
    ],
  });
  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    return Array.isArray(parsed.updates) ? parsed.updates : [];
  } catch {
    return [];
  }
}

/**
 * Apply stock updates to the products table. Returns array of { product, applied, error }.
 */
export async function applyStockChanges(businessId, updates) {
  const sb = supabase();
  const { data: products } = await sb.from('products')
    .select('id, name, name_am, stock_quantity')
    .eq('business_id', businessId).eq('is_active', true);
  const results = [];
  for (const u of updates || []) {
    const q = (u.product_name || '').toLowerCase();
    const match = (products || []).find(p =>
      (p.name || '').toLowerCase() === q ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.name_am || '').toLowerCase().includes(q)
    );
    if (!match) { results.push({ product: u.product_name, error: 'no catalog match' }); continue; }
    const cur = Number(match.stock_quantity || 0);
    let next = cur;
    if (u.set_to != null) next = Math.max(0, Math.floor(Number(u.set_to)));
    else if (u.delta != null) next = Math.max(0, cur + Math.floor(Number(u.delta)));
    else { results.push({ product: match.name, error: 'no delta or set_to' }); continue; }
    await sb.from('products').update({ stock_quantity: next }).eq('id', match.id);
    results.push({ product: match.name, before: cur, after: next, note: u.note });
  }
  return results;
}

/**
 * Generic teach entry-point used by the /api/teach endpoint and the bot.
 * Heuristic: if the text looks like the owner describing their shop →
 * saveBusinessBrief. Otherwise → treat as a forwarded client snippet.
 */
export async function teachFromText(businessId, text, { forwardedFrom, attachedCustomerId } = {}) {
  const isForwarded = !!forwardedFrom || !!attachedCustomerId;
  if (isForwarded) {
    const extracted = await extractFromClientMessage(text, forwardedFrom ? `Forwarded from: ${forwardedFrom}` : '');
    if (!extracted) return { ok: false, error: 'could not extract' };
    await saveClientFacts(businessId, attachedCustomerId || null, extracted);
    return { ok: true, kind: 'client-facts', extracted };
  }
  const extracted = await extractBusinessFacts(text);
  const result = await saveBusinessBrief(businessId, { text, extracted });
  return { ok: result.ok, kind: 'business-brief', extracted, ...result };
}

// ────────────────────────────── Product extraction from forwarded messages ──────────────────────────────

/**
 * Detect whether a forwarded message describes a product (with name + price).
 * Returns { name, name_am, price, currency, stock_quantity, description, category } or null.
 */
export async function extractProductFromMessage(text) {
  if (!text || text.length < 5) return null;
  // Quick check: does the text mention a price-like pattern?
  const hasPrice = /(\d[\d,]*\.?\d*)\s*(ETB|birr|ብር|USD|\$|br)/i.test(text);
  const hasProductSignals = /\b(new item|added|arrived|now selling|for sale|in stock|price|ዋጋ|እቃ)\b/i.test(text) || hasPrice;
  if (!hasProductSignals) return null;

  const completion = await openai.chat.completions.create({
    model: MODEL_MINI,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You extract product information from a forwarded message that a shop owner sent about their inventory. Return JSON:
{
  "is_product": true/false,
  "name": "product name in English or original language",
  "name_am": "product name in Amharic if present, else null",
  "price": <number or null>,
  "currency": "ETB" or "USD" (default ETB),
  "stock_quantity": <number or null if not mentioned>,
  "description": "short product description (max 100 chars) or null",
  "category": "category if obvious, else null"
}

If this is NOT about a specific product (e.g., it's a general message, greeting, or question), return {"is_product": false}.
Parse prices: "150 birr" = 150 ETB, "$20" = 20 USD, "500ብር" = 500 ETB.`,
      },
      { role: 'user', content: text.slice(0, 2000) },
    ],
  });
  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    if (!parsed.is_product || !parsed.name) return null;
    return {
      name: parsed.name,
      name_am: parsed.name_am || null,
      price: parsed.price != null ? Number(parsed.price) : null,
      currency: parsed.currency || 'ETB',
      stock_quantity: parsed.stock_quantity != null ? Math.floor(Number(parsed.stock_quantity)) : null,
      description: parsed.description || null,
      category: parsed.category || null,
    };
  } catch {
    return null;
  }
}

/**
 * Create or update a product from forwarded message data.
 * If a product with the same name exists → update its price/stock/description.
 * Otherwise → create a new product.
 * Returns { created: boolean, product: {...} }.
 */
export async function upsertProductFromForward(businessId, extracted, imageUrl) {
  const sb = supabase();
  const q = (extracted.name || '').toLowerCase().trim();
  if (!q) return null;

  // Try to match existing product (by English name or Amharic name)
  const { data: existing } = await sb.from('products')
    .select('id, name, name_am, price, currency, stock_quantity')
    .eq('business_id', businessId).eq('is_active', true);

  const match = (existing || []).find(p =>
    (p.name || '').toLowerCase().trim() === q ||
    (extracted.name_am && (p.name_am || '').toLowerCase().trim() === extracted.name_am.toLowerCase().trim())
  );

  if (match) {
    // Update existing product
    const updates = {};
    if (extracted.price != null) updates.price = extracted.price;
    if (extracted.currency) updates.currency = extracted.currency;
    if (extracted.stock_quantity != null) updates.stock_quantity = extracted.stock_quantity;
    if (extracted.description) updates.description = extracted.description;
    if (extracted.name_am && !match.name_am) updates.name_am = extracted.name_am;
    if (imageUrl) updates.image_url = imageUrl;
    // Auto-translate name to Amharic if still missing
    if (!match.name_am && !extracted.name_am) {
      try {
        const nameAm = await translateToAmharic(extracted.name || match.name);
        if (nameAm) updates.name_am = nameAm;
      } catch {}
    }
    if (Object.keys(updates).length) {
      await sb.from('products').update(updates).eq('id', match.id);
    }
    return { created: false, product: { ...match, ...updates } };
  }

  // Auto-translate name to Amharic if not already provided
  let nameAm = extracted.name_am || null;
  if (!nameAm) {
    try { nameAm = await translateToAmharic(extracted.name) || null; } catch {}
  }

  // Create new product
  const insert = {
    business_id: businessId,
    name: extracted.name,
    name_am: nameAm,
    price: extracted.price || 0,
    currency: extracted.currency || 'ETB',
    stock_quantity: extracted.stock_quantity ?? 0,
    description: extracted.description || null,
    category: extracted.category || null,
    image_url: imageUrl || null,
    is_active: true,
  };
  const { data: created } = await sb.from('products').insert(insert).select().single();
  return { created: true, product: created };
}
