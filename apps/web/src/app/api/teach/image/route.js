/**
 * POST /api/teach/image
 * Owner uploads a photo (menu, price list, product, handwritten note, etc.).
 * Uses OpenAI Vision to describe and extract structured info from the image,
 * then embeds the result as a searchable knowledge document.
 *
 * Supports: JPG, PNG, WebP, HEIC (max 15 MB)
 */
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { MODEL, EMBED_MODEL } from '../../../../lib/server/constants';
import { extractProductsFromText, extractProductFromMessage, upsertProductFromForward } from '../../../../lib/server/teaching';
import { storeProductPhoto } from '../../../../lib/server/productImages';
import { tagProductImage } from '../../../../lib/server/productImageTags';
import crypto from 'node:crypto';
import { makeOpenAI } from '../../../../lib/server/openaiClient';

const openai = makeOpenAI();

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Parse multipart form
  let formData;
  try { formData = await request.formData(); }
  catch { return NextResponse.json({ error: 'invalid form data' }, { status: 400 }); }

  const file = formData.get('file');
  if (!file) return NextResponse.json({ error: 'no file provided' }, { status: 400 });

  const title = (formData.get('title') || file.name || 'Photo').slice(0, 200);
  const mimeType = file.type || 'image/jpeg';
  // Set by the onboarding wizard's 📷 chip only — signals "this is a photo of
  // one product," as opposed to the 📄 price-list chip or a generic upload.
  const intent = (formData.get('intent') || '').toString();

  if (!mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image files are supported here. Use /api/documents/upload for PDFs.' }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image too large (max 15 MB)' }, { status: 400 });
  }

  // Convert to base64 for the OpenAI Vision API
  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const base64 = buf.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // Ask GPT-4 Vision to extract all useful business information from the image
  let description;
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: `You are helping a small business owner teach their AI assistant about their business by reading a photo they uploaded.
Extract ALL useful business information from this image — prices, products, services, menu items, contact details, hours, addresses, policies, etc.
Format your response as clear, structured plain text that the AI can search and reference.
Start with: "From the uploaded photo:"
Be specific about prices, quantities, and details. If it's a price list, list every item. If it's a menu, list all dishes and prices.
Business name: ${business.name} (category: ${business.category || 'general'})`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Please read this photo and extract all business information from it.' },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    });
    description = res.choices[0]?.message?.content?.trim();
  } catch (e) {
    console.error('[teach/image] vision failed:', e.message);
    return NextResponse.json({ error: 'Could not read image — please try a clearer photo' }, { status: 500 });
  }

  if (!description) {
    return NextResponse.json({ error: 'No information could be extracted from this image' }, { status: 422 });
  }

  // Embed the description as a searchable knowledge document
  const sb = supabase();
  const fp = crypto.createHash('sha1').update(description.slice(0, 200)).digest('hex').slice(0, 16);

  // Create document record
  const { data: doc } = await sb.from('documents').insert({
    business_id: business.id,
    title: title.replace(/\.(jpg|jpeg|png|webp|heic)$/i, '') || 'Photo',
    tag: 'image_upload',
    description: description.slice(0, 500),
    mime_type: mimeType,
    original_filename: file.name,
    status: 'embedding',
    meta: { fp, source: 'image_upload', vision_extracted: true },
  }).select().single();

  if (!doc) {
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }

  // Embed the description
  try {
    const embRes = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: [description],
    });
    const embedding = embRes.data[0].embedding;

    await sb.from('document_chunks').insert({
      document_id: doc.id,
      business_id: business.id,
      chunk_index: 0,
      content: description,
      token_count: Math.ceil(description.length / 4),
      embedding,
    });

    await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);
  } catch (e) {
    console.warn('[teach/image] embedding failed:', e.message);
    await sb.from('documents').update({ status: 'failed' }).eq('id', doc.id);
    return NextResponse.json({ error: 'Could not embed knowledge — please try again' }, { status: 500 });
  }

  // intent === 'product_photo' (the onboarding 📷 chip) additionally stores the
  // actual image in Storage and attaches it to the product it produces, so a
  // plain product shot becomes that shop's MiniMe Search thumbnail (see
  // /api/directory/search's first_product_image fallback). Storage failures
  // degrade silently — the document + catalog extraction above must not be
  // lost just because the thumbnail step failed.
  let image_url = null;
  // Visual attributes (color/material/style) — a second, cheap vision call
  // separate from the OCR-style extraction above; that one reads text in the
  // photo (prices, menus), this one describes what the product looks like,
  // so a bare product shot with no visible price/text is still findable by
  // e.g. "red dress". Best-effort: tagProductImage never throws.
  let image_tags = null;
  if (intent === 'product_photo') {
    try {
      ({ image_url } = await storeProductPhoto(sb, business.id, file, buf, { label: doc.id }));
    } catch (e) {
      console.warn('[teach/image] photo storage skipped:', e.message);
    }
    if (image_url) {
      ({ tags: image_tags } = await tagProductImage(image_url));
    }
  }
  const source = intent === 'product_photo' ? 'onboarding_photo' : null;

  // A photo of a price list / menu should populate the structured catalog,
  // not just the searchable narrative — that's what the "extract all prices,
  // products" promise means, and it's what orders/checkout/search need.
  let products_added = 0, products_updated = 0;
  try {
    const items = await extractProductsFromText(description);
    for (let i = 0; i < items.length; i++) {
      // Only the first item gets the photo (and its tags) — a multi-item
      // extraction (shelf, price list) shouldn't make every product share
      // one thumbnail.
      const r = await upsertProductFromForward(business.id, items[i], i === 0 ? image_url : null, source, i === 0 ? image_tags : null);
      if (r?.created) products_added++; else if (r) products_updated++;
    }
    // The owner's explicit signal was "this is a product photo" — a bare
    // product shot with no visible price commonly fails the plural
    // extractor's price-list gate and returns zero items, so don't let that
    // signal get dropped. Fall back to the single-item extractor, then to a
    // minimal stub product, so the photo always attaches to something real.
    if (items.length === 0 && intent === 'product_photo' && image_url) {
      const single = await extractProductFromMessage(description);
      const extracted = single || {
        name: description.replace(/^From the uploaded photo:\s*/i, '').split(/\r?\n/)[0].trim().slice(0, 80) || title,
      };
      const r = await upsertProductFromForward(business.id, extracted, image_url, source, image_tags);
      if (r?.created) products_added++; else if (r) products_updated++;
    }
  } catch (e) {
    console.warn('[teach/image] catalog extraction failed:', e.message);
  }

  return NextResponse.json({
    ok: true,
    document_id: doc.id,
    summary: description.slice(0, 200),
    title,
    products_added,
    products_updated,
    image_url,
  });
}
