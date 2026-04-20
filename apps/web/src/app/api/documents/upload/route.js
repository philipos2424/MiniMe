import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = (text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const br = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('። '));
      if (br > size * 0.5) end = i + br + 1;
    }
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks.filter(Boolean);
}

async function extractText(buffer, mimeType, filename) {
  const name = (filename || '').toLowerCase();
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
    // unpdf is serverless-safe (no DOMMatrix / canvas deps)
    const { extractText: unpdfExtract, getDocumentProxy } = await import('unpdf');
    const uint8 = new Uint8Array(buffer);
    const pdf = await getDocumentProxy(uint8);
    const { text, totalPages } = await unpdfExtract(pdf, { mergePages: true });
    return { text: text || '', pageCount: totalPages || null };
  }
  if ((mimeType && mimeType.startsWith('text/')) || name.endsWith('.txt') || name.endsWith('.md')) {
    return { text: buffer.toString('utf8'), pageCount: null };
  }
  throw new Error(`Unsupported file type: ${mimeType || filename}`);
}

export async function POST(request) {
  try {
    const initData = request.headers.get('x-telegram-init-data');
    if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
      return NextResponse.json({ error: 'Invalid Telegram data' }, { status: 401 });
    }
    const user = parseTelegramUser(initData);
    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_telegram_id', user.id)
      .single();
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 404 });

    const form = await request.formData();
    const file = form.get('file');
    const title = form.get('title') || '';
    const tag = form.get('tag') || null;
    const description = form.get('description') || null;
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || 'document';
    const mimeType = file.type || 'application/octet-stream';

    const storagePath = `${business.id}/${Date.now()}-${filename.replace(/[^\w.\-]/g, '_')}`;
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .insert({
        business_id: business.id,
        title: title || filename,
        tag,
        description,
        mime_type: mimeType,
        storage_path: storagePath,
        original_filename: filename,
        byte_size: buffer.length,
        status: 'extracting',
      })
      .select()
      .single();
    if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });

    // Extract + chunk + embed (inline — simple, under 60s for typical PDFs)
    try {
      const { text, pageCount } = await extractText(buffer, mimeType, filename);
      if (!text || !text.trim()) throw new Error('No text extracted');
      const chunks = chunkText(text);
      if (!chunks.length) throw new Error('No chunks produced');

      await supabase.from('documents').update({ status: 'embedding', page_count: pageCount }).eq('id', doc.id);

      const BATCH = 64;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const slice = chunks.slice(i, i + BATCH);
        const embResp = await getOpenAI().embeddings.create({
          model: 'text-embedding-3-small',
          input: slice,
        });
        const rows = slice.map((content, j) => ({
          document_id: doc.id,
          business_id: business.id,
          chunk_index: i + j,
          content,
          token_count: Math.round(content.length / 4),
          embedding: embResp.data[j].embedding,
        }));
        const { error: chErr } = await supabase.from('document_chunks').insert(rows);
        if (chErr) throw new Error(`chunks insert: ${chErr.message}`);
      }

      await supabase.from('documents').update({ status: 'ready', error: null }).eq('id', doc.id);
      return NextResponse.json({ ok: true, document: { ...doc, status: 'ready' }, chunks: chunks.length });
    } catch (e) {
      console.error('Ingest error:', e);
      await supabase.from('documents').update({ status: 'failed', error: e.message }).eq('id', doc.id);
      return NextResponse.json({ ok: false, document: doc, error: e.message }, { status: 500 });
    }
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
