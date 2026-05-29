import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { EMBED_MODEL } from '../../../../lib/server/constants';

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

const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'video/mp4', 'video/quicktime', // for portfolio/demo videos (stored, not embedded)
]);

function isImage(mimeType) {
  return (mimeType || '').startsWith('image/');
}
function isVideo(mimeType) {
  return (mimeType || '').startsWith('video/');
}

async function extractText(buffer, mimeType, filename, openai) {
  const name = (filename || '').toLowerCase();

  // PDF extraction
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
    const { extractText: unpdfExtract, getDocumentProxy } = await import('unpdf');
    const uint8 = new Uint8Array(buffer);
    const pdf = await getDocumentProxy(uint8);
    const { text, totalPages } = await unpdfExtract(pdf, { mergePages: true });
    return { text: text || '', pageCount: totalPages || null, isImage: false };
  }

  // Plain text / markdown / CSV
  if ((mimeType && mimeType.startsWith('text/')) || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
    return { text: buffer.toString('utf8').slice(0, 100000), pageCount: null, isImage: false };
  }

  // Word documents — extract as plain text via basic parsing
  if (mimeType?.includes('wordprocessingml') || name.endsWith('.docx') || name.endsWith('.doc')) {
    try {
      // Use basic text extraction from DOCX (XML-based)
      const JSZip = await import('jszip');
      const zip = await JSZip.default.loadAsync(buffer);
      const wordXml = zip.files['word/document.xml'];
      if (wordXml) {
        const xml = await wordXml.async('text');
        const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return { text: text.slice(0, 100000), pageCount: null, isImage: false };
      }
    } catch {}
    return { text: `${filename} (Word document — content could not be extracted)`, pageCount: null, isImage: false };
  }

  // Images — use Vision API to describe content (makes them searchable)
  if (isImage(mimeType)) {
    try {
      const base64 = buffer.toString('base64');
      const visionRes = await openai.chat.completions.create({
        model: 'gpt-4.1-mini', // fast + cheap for description
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [{
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' },
          }, {
            type: 'text',
            text: 'Describe everything visible in this image in detail. Include: all text visible, prices, product names, contact info, and any relevant business information. This will be used to help customers find this file.',
          }],
        }],
      });
      const description = visionRes.choices[0]?.message?.content || '';
      return { text: description, pageCount: null, isImage: true };
    } catch (e) {
      console.warn('Vision API failed for image:', e.message);
      return { text: `Image: ${filename}`, pageCount: null, isImage: true };
    }
  }

  // Videos — no text extraction, just store for sending
  if (isVideo(mimeType)) {
    return { text: `Video: ${filename}`, pageCount: null, isImage: false };
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

    // Validate file type
    const fileIsImage = isImage(mimeType);
    const fileIsVideo = isVideo(mimeType);
    if (!ALLOWED_MIME.has(mimeType) && !fileIsImage && !fileIsVideo) {
      return NextResponse.json({
        error: `File type "${mimeType}" is not supported. Upload PDF, Word, image (JPG/PNG/WebP), or text files.`,
      }, { status: 415 });
    }

    // Size limits: 50MB for videos, 20MB for images, 10MB for docs
    const maxBytes = fileIsVideo ? 50 * 1024 * 1024 : fileIsImage ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return NextResponse.json({ error: `File too large. Max size: ${maxBytes / 1024 / 1024} MB` }, { status: 413 });
    }

    const storagePath = `${business.id}/${Date.now()}-${filename.replace(/[^\w.\-]/g, '_')}`;
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

    // Get public URL so Alfred can send the file to customers directly
    const { data: pubData } = supabase.storage.from('documents').getPublicUrl(storagePath);
    const fileUrl = pubData?.publicUrl || null;

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
        meta: fileUrl ? { file_url: fileUrl, is_image: fileIsImage, is_video: fileIsVideo } : null,
      })
      .select()
      .single();
    if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });

    // For videos — skip text extraction, mark ready immediately
    if (fileIsVideo) {
      await supabase.from('documents').update({ status: 'ready' }).eq('id', doc.id);
      return NextResponse.json({ ok: true, document: { ...doc, status: 'ready', file_url: fileUrl } });
    }

    // Extract + chunk + embed
    const openai = getOpenAI();
    try {
      const { text, pageCount } = await extractText(buffer, mimeType, filename, openai);
      if (!text || !text.trim()) throw new Error('No text extracted');
      const chunks = chunkText(text);
      if (!chunks.length) throw new Error('No chunks produced');

      await supabase.from('documents').update({ status: 'embedding', page_count: pageCount }).eq('id', doc.id);

      const BATCH = 64;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const slice = chunks.slice(i, i + BATCH);
        const embResp = await getOpenAI().embeddings.create({
          model: EMBED_MODEL,
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
