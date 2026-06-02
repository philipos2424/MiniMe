/**
 * GET  /api/agent/knowledge  → list all KB sources (docs + ingested URLs + business socials)
 * DELETE /api/agent/knowledge?id=<doc_id>  → remove a source
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolve(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findBusinessForUser(tg.id) : null;
}

export async function GET(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const { data: docs } = await sb.from('documents')
    .select('id, title, tag, original_filename, mime_type, meta, status, created_at, updated_at')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });

  // Chunk counts per doc
  const ids = (docs || []).map(d => d.id);
  let chunkCounts = {};
  if (ids.length) {
    const { data: chunks } = await sb.from('document_chunks')
      .select('document_id').in('document_id', ids);
    for (const c of chunks || []) chunkCounts[c.document_id] = (chunkCounts[c.document_id] || 0) + 1;
  }

  const sources = (docs || []).map(d => ({
    id: d.id,
    kind: d.meta?.url ? 'url' : 'file',
    title: d.title || d.original_filename,
    url: d.meta?.url || null,
    filename: d.meta?.url ? null : d.original_filename,
    tag: d.tag,
    status: d.status,
    chunks: chunkCounts[d.id] || 0,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));

  // Surface the business's configured public presence so the owner can one-tap-learn each.
  const socials = {
    website: business.website || null,
    portfolio: business.portfolio_url || null,
    instagram: business.instagram || null,
    facebook: business.facebook || null,
    tiktok: business.tiktok || null,
    telegram_channel: business.telegram_channel || null,
  };

  return NextResponse.json({ sources, socials });
}

/**
 * POST /api/agent/knowledge — create a quick Q&A knowledge item (used from onboarding).
 * Body: { title, body, source? }
 */
export async function POST(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const title = (body.title || '').trim();
  const content = (body.body || '').trim();
  if (!title || !content) return NextResponse.json({ error: 'title and body required' }, { status: 400 });

  const sb = supabase();
  const fullText = `Q: ${title}\nA: ${content}`;

  const { data: doc, error } = await sb.from('documents').insert({
    business_id: business.id,
    title,
    tag: body.source === 'onboarding' ? 'onboarding' : 'faq',
    description: fullText.slice(0, 400),
    mime_type: 'text/plain',
    status: 'ready',
    meta: { source: body.source || 'manual', qa: true },
  }).select().maybeSingle();

  if (error || !doc) return NextResponse.json({ error: error?.message || 'insert failed' }, { status: 500 });

  // Insert a single chunk so it's immediately searchable
  await sb.from('document_chunks').insert({
    document_id: doc.id,
    business_id: business.id,
    content: fullText,
    chunk_index: 0,
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, id: doc.id });
}

export async function DELETE(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = supabase();
  const { data: doc } = await sb.from('documents').select('id, storage_path, business_id').eq('id', id).maybeSingle();
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.business_id !== business.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (doc.storage_path) {
    try { await sb.storage.from('documents').remove([doc.storage_path]); } catch {}
  }
  await sb.from('document_chunks').delete().eq('document_id', id);
  await sb.from('documents').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
