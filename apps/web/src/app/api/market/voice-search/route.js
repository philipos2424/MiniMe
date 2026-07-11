/**
 * POST /api/market/voice-search — transcribe a browser-recorded voice search.
 *
 * Public (like the rest of /api/market/*), multipart/form-data with an
 * 'audio' field (whatever MediaRecorder produced — webm/opus on Chrome,
 * mp4/aac on Safari). Whisper-only here (not Hasab, which is used for
 * Telegram voice search): browser output formats are unpredictable across
 * browsers, and Whisper has broad documented tolerance for them, whereas
 * Hasab's buffer→mime mapping only cleanly covers ogg/mp3/mp4.
 *
 * Deliberately does NOT run the search itself — returns { text } and the
 * client calls the existing /api/market/catalog?q=... unchanged, so assist
 * text, chips, trending, and notify-me all keep working with zero duplicated
 * search logic.
 */
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { openai } from '../../../../lib/server/openai-wrapper';
import { rateLimit } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — generous for a short search query

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || '0.0.0.0';
  const rl = rateLimit(ip, 'market-voice', 20, 60);
  if (!rl.ok) return NextResponse.json({ error: 'Too many voice searches — try again in a bit.' }, { status: 429 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!audio || typeof audio === 'string') {
    return NextResponse.json({ error: 'audio field required' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Recording too long' }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await audio.arrayBuffer());
    // Extension inferred from the browser's mime type; Whisper mostly infers
    // format from content anyway, but a matching filename avoids edge cases.
    const mime = audio.type || '';
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
    const file = await OpenAI.toFile(buf, `search.${ext}`);
    const tr = await openai.audio.transcriptions.create({ model: 'whisper-1', file });
    const text = (tr.text || '').trim();
    if (!text) return NextResponse.json({ error: "Couldn't catch that — try again or type instead." }, { status: 422 });
    return NextResponse.json({ text });
  } catch (e) {
    console.error('[market/voice-search]', e.message);
    return NextResponse.json({ error: 'Transcription failed — try again or type instead.' }, { status: 500 });
  }
}
