/**
 * Voice + photo transcription for the webhook reply engine.
 *
 * The polling bot used `bot.getFileLink(fileId)` — we don't have a bot
 * instance here, so we hit the Telegram Bot API directly:
 *   1. POST /getFile  → { file_path }
 *   2. GET  https://api.telegram.org/file/bot<token>/<file_path>
 */
import OpenAI from 'openai';
import { MODEL } from './constants';
import { transcribeWithHasab } from './hasab';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getFileUrl(token, fileId) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  const j = await r.json();
  if (!j?.ok || !j.result?.file_path) throw new Error(`getFile failed: ${j?.description}`);
  return `https://api.telegram.org/file/bot${token}/${j.result.file_path}`;
}

export async function transcribeTelegramAudio(token, msg) {
  try {
    const media = msg.voice || msg.audio || msg.video_note;
    if (!media) return null;

    const fileUrl = await getFileUrl(token, media.file_id);
    const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`file download ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const ext = msg.voice ? 'ogg' : (msg.audio?.mime_type || '').includes('mpeg') ? 'mp3' : 'mp4';

    // Try Hasab first — native Amharic ASR is far more accurate than Whisper for Ethiopic.
    // Hasab also returns an English translation alongside the Amharic transcript.
    const hasabResult = await transcribeWithHasab(buf, ext, { language: 'auto', translate: true });
    if (hasabResult?.text) {
      return {
        text: hasabResult.text,
        translation: hasabResult.translation || null,
        duration: hasabResult.durationSeconds || media.duration || null,
        via: 'hasab',
      };
    }

    // Fallback: OpenAI Whisper (works well for English/mixed)
    const file = await OpenAI.toFile(buf, `voice.${ext}`);
    const tr = await openai.audio.transcriptions.create({ model: 'whisper-1', file });
    return { text: (tr.text || '').trim(), duration: media.duration || null, via: 'whisper' };
  } catch (err) {
    console.error('transcribeTelegramAudio:', err.message);
    return null;
  }
}

export async function describeTelegramPhoto(token, msg) {
  try {
    const photos = msg.photo;
    if (!photos?.length) return null;
    const best = photos[photos.length - 1];
    const fileUrl = await getFileUrl(token, best.file_id);

    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text:
`Analyze this image as if you're helping a small-business owner reply to their customer.

Return a STRUCTURED description with these sections (skip empty ones):
• WHAT: 1 line — product / receipt / screenshot / document / selfie / other
• TEXT: verbatim quote of any Amharic or English text visible (prices, names, item lists, phone numbers, invoice totals)
• DETAILS: colors, condition, quantity, size, model numbers, brand — anything a seller would need to answer questions
• INTENT GUESS: what the customer probably wants (buying this? asking a price match? reporting a problem? sharing a receipt?)

Be thorough — this is the ONLY way the reply engine will "see" the image.` },
          { type: 'image_url', image_url: { url: fileUrl, detail: 'high' } },
        ],
      }],
    });
    return (resp.choices[0]?.message?.content || '').trim() || null;
  } catch (err) {
    console.error('describeTelegramPhoto:', err.message);
    return null;
  }
}

/**
 * Extract text + summary from a PDF / doc a customer sends.
 * Returns a markdown summary the reply engine can feed into the LLM.
 */
export async function readTelegramDocument(token, msg) {
  try {
    const doc = msg.document;
    if (!doc) return null;
    const mime = doc.mime_type || '';
    const fileUrl = await getFileUrl(token, doc.file_id);

    // Images sent as "document" (Telegram keeps full resolution) → vision
    if (mime.startsWith('image/')) {
      const resp = await openai.chat.completions.create({
        model: MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image. Transcribe every line of Amharic or English text. Then describe the subject in 2-3 sentences.' },
            { type: 'image_url', image_url: { url: fileUrl, detail: 'high' } },
          ],
        }],
      });
      return (resp.choices[0]?.message?.content || '').trim() || null;
    }

    // Plaintext / CSV / JSON
    if (mime.startsWith('text/') || mime === 'application/json') {
      const r = await fetch(fileUrl, { signal: AbortSignal.timeout(20000) });
      const text = (await r.text()).slice(0, 8000);
      return `[${doc.file_name || 'text file'}]\n\n${text}`;
    }

    // PDF → extract with pdf-parse then summarize
    if (mime === 'application/pdf' || (doc.file_name || '').toLowerCase().endsWith('.pdf')) {
      const r = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
      const buf = Buffer.from(await r.arrayBuffer());
      let extracted = '';
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const parsed = await pdfParse(buf);
        extracted = (parsed.text || '').slice(0, 12000);
      } catch (e) {
        console.warn('pdf-parse failed:', e.message);
      }
      if (!extracted) return `[PDF ${doc.file_name || ''} — could not extract text]`;

      // Ask the LLM to summarize what matters to a seller
      const resp = await openai.chat.completions.create({
        model: MODEL,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `A customer sent this PDF. Summarize what it contains for the seller:

• DOC TYPE: invoice / quote / spec sheet / brochure / receipt / contract / other
• KEY FACTS: amounts, dates, item lists, names, contact info — bulleted
• WHAT THE CUSTOMER LIKELY WANTS: 1 sentence

PDF TEXT:
${extracted}`,
        }],
      });
      const summary = (resp.choices[0]?.message?.content || '').trim();
      return `[PDF ${doc.file_name || ''}]\n\n${summary}`;
    }

    return `[${doc.file_name || 'file'} — ${mime || 'unknown type'}, not analyzed]`;
  } catch (err) {
    console.error('readTelegramDocument:', err.message);
    return null;
  }
}
