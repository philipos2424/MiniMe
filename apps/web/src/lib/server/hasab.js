/**
 * Hasab AI API client — Amharic-first NLP for MiniMe.
 *
 * Base URL: https://api.hasab.ai/api/v1/
 * Auth: Bearer token (HASAB_API_KEY env var)
 *
 * Used for:
 *   1. transcribeWithHasab()  — transcribe Amharic voice messages from Telegram
 *                               (Whisper-1 struggles with Amharic; Hasab is native)
 *   2. translateToAmharic()   — translate English text → Amharic (product names, etc.)
 *   3. translateFromAmharic() — translate Amharic text → English (incoming messages)
 *   4. chatWithHasab()        — ask Hasab's own LLM a question in Amharic
 */

const HASAB_BASE = 'https://api.hasab.ai/api/v1';
const HASAB_KEY = process.env.HASAB_API_KEY || 'HASAB_KEY_wPqxPVC94BkJDGfYwU0Lisev32ExYr';

function hasabHeaders() {
  return {
    Authorization: `Bearer ${HASAB_KEY}`,
  };
}

/**
 * Transcribe a Telegram voice/audio file using Hasab (optimised for Amharic).
 * Falls back to null on any error so the caller can fall back to Whisper.
 *
 * @param {Buffer} audioBuffer  — raw audio bytes
 * @param {string} ext          — file extension: 'ogg', 'mp3', 'm4a'
 * @param {object} opts
 * @param {string} opts.language  — target transcript language code ('amh' | 'eng' | 'auto')
 * @param {boolean} opts.translate — also return English translation alongside transcript
 * @returns {{ text: string, translation?: string, durationSeconds?: number } | null}
 */
export async function transcribeWithHasab(audioBuffer, ext, { language = 'auto', translate = false } = {}) {
  try {
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: `audio/${ext === 'ogg' ? 'ogg' : ext === 'mp3' ? 'mpeg' : 'mp4'}` });
    form.append('audio', blob, `voice.${ext}`);
    form.append('transcribe', 'true');
    form.append('translate', translate ? 'true' : 'false');
    form.append('summarize', 'false');
    form.append('language', language);

    const res = await fetch(`${HASAB_BASE}/upload-audio`, {
      method: 'POST',
      headers: hasabHeaders(),
      body: form,
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.warn(`[Hasab] transcribe failed ${res.status}:`, err);
      return null;
    }

    const j = await res.json();
    if (!j.success) { console.warn('[Hasab] transcribe not ok:', j.message); return null; }

    return {
      text: (j.audio?.transcription || '').trim(),
      translation: (j.audio?.translation || '').trim() || null,
      durationSeconds: j.audio?.duration_in_seconds || null,
    };
  } catch (e) {
    console.warn('[Hasab] transcribeWithHasab:', e.message);
    return null;
  }
}

/**
 * Translate text from English to Amharic via Hasab audio pipeline.
 * Uses Hasab's chat endpoint for text-only translation (simpler + no file needed).
 *
 * @param {string} text
 * @returns {string|null}  Amharic translation, or null on failure
 */
export async function translateToAmharic(text) {
  if (!text?.trim()) return null;
  return _hasabTranslate(text, 'eng', 'amh');
}

/**
 * Translate Amharic text to English via Hasab.
 * @param {string} text
 * @returns {string|null}
 */
export async function translateFromAmharic(text) {
  if (!text?.trim()) return null;
  return _hasabTranslate(text, 'amh', 'eng');
}

/**
 * Low-level translation helper using the Hasab chat API.
 * We use the chat endpoint for text-to-text translation since it doesn't
 * require audio uploads and supports both directions.
 */
async function _hasabTranslate(text, sourceLang, targetLang) {
  try {
    const langNames = { amh: 'Amharic', eng: 'English' };
    const prompt = `Translate the following ${langNames[sourceLang] || sourceLang} text to ${langNames[targetLang] || targetLang}. Reply with ONLY the translation, nothing else.\n\n${text.slice(0, 2000)}`;

    const res = await fetch(`${HASAB_BASE}/chat`, {
      method: 'POST',
      headers: {
        ...hasabHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: prompt,
        model: 'hasab-1-lite',
        temperature: 0.1,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[Hasab] translate failed ${res.status}`);
      return null;
    }

    const j = await res.json();
    const translated = (j.message?.content || '').trim();
    return translated || null;
  } catch (e) {
    console.warn('[Hasab] translateText:', e.message);
    return null;
  }
}

/**
 * Ask Hasab's LLM a question — useful for Amharic-native responses.
 * @param {string} message
 * @param {object} opts
 * @param {string} opts.model  — 'hasab-1-lite' | 'hasab-1-main'
 * @returns {{ content: string, tokensUsed: number } | null}
 */
export async function chatWithHasab(message, { model = 'hasab-1-lite' } = {}) {
  try {
    const res = await fetch(`${HASAB_BASE}/chat`, {
      method: 'POST',
      headers: {
        ...hasabHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: message.slice(0, 4000), model, temperature: 0.7, max_tokens: 1024 }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) { console.warn('[Hasab] chat failed', res.status); return null; }
    const j = await res.json();
    return {
      content: (j.message?.content || '').trim(),
      tokensUsed: j.usage?.total_tokens || 0,
    };
  } catch (e) {
    console.warn('[Hasab] chatWithHasab:', e.message);
    return null;
  }
}
