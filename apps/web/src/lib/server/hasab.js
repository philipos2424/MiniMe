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
const HASAB_KEY = process.env.HASAB_API_KEY;

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
 */
async function _hasabTranslate(text, sourceLang, targetLang) {
  try {
    const langNames = { amh: 'Amharic', eng: 'English' };
    const amharicHint = targetLang === 'amh'
      ? `Use everyday spoken Amharic like a friendly Addis shopkeeper texting on Telegram — NOT formal/written register, NOT translated-English-Amharic. Keep English business terms as-is (ETB, delivery, discount, brand names, prices in numerals). PRESERVE identity language exactly: if the source says "AI assistant" or "I'm the assistant", the translation must keep that role — don't rephrase to make the speaker sound like the owner ("ባለቤት ነኝ" is forbidden). Short (1-2 lines max), warm, natural — like እንኳን መጡ / እሺ / አዎ rhythm.`
      : '';
    const prompt = `Translate the following ${langNames[sourceLang] || sourceLang} text to ${langNames[targetLang] || targetLang}. ${amharicHint} Reply with ONLY the translation, nothing else.\n\n${text.slice(0, 2000)}`;

    // hasab-1-main is noticeably more native than -lite for spoken Amharic
    // (vs sounding like translated English). Worth the small latency hit on
    // the reply path; we cap timeout below for safety.
    const j = await _hasabChatRaw(prompt, { model: 'hasab-1-main', temperature: 0.2, max_tokens: 512, timeout: 12000 });
    return j ? (j.message?.content || '').trim() || null : null;
  } catch (e) {
    console.warn('[Hasab] translateText:', e.message);
    return null;
  }
}

/**
 * Core HTTP call to Hasab /chat — full API format.
 * @param {string} message
 * @param {object} opts
 * @returns {object|null} Raw JSON response body
 */
async function _hasabChatRaw(message, {
  model = 'hasab-1-lite',
  temperature = 0.7,
  max_tokens = 2048,
  stream = false,
  tools = null,
  timeout = 30000,
} = {}) {
  const body = { message: String(message).slice(0, 8000), model, temperature, max_tokens, stream };
  if (tools !== null && tools !== undefined) body.tools = tools;

  const res = await fetch(`${HASAB_BASE}/chat`, {
    method: 'POST',
    headers: { ...hasabHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => String(res.status));
    console.warn(`[Hasab] /chat ${res.status}:`, txt.slice(0, 200));
    return null;
  }
  return res.json();
}

/**
 * Ask Hasab's LLM a question — matches the API format shown in Hasab docs:
 * { message, model, temperature, max_tokens, stream, tools }
 *
 * @param {string} message
 * @param {object} opts
 * @param {string}  opts.model       — 'hasab-1-lite' | 'hasab-1-main'
 * @param {number}  opts.temperature — 0–1, default 0.7
 * @param {number}  opts.max_tokens  — default 2048
 * @param {boolean} opts.stream      — default false
 * @param {Array|null} opts.tools    — tool definitions (null = disabled)
 * @returns {{ content: string, tokensUsed: number } | null}
 */
export async function chatWithHasab(message, {
  model = 'hasab-1-lite',
  temperature = 0.7,
  max_tokens = 2048,
  stream = false,
  tools = null,
} = {}) {
  try {
    const j = await _hasabChatRaw(message, { model, temperature, max_tokens, stream, tools });
    if (!j) return null;
    return {
      content: (j.message?.content || '').trim(),
      tokensUsed: j.usage?.total_tokens || 0,
      model: j.model || model,
    };
  } catch (e) {
    console.warn('[Hasab] chatWithHasab:', e.message);
    return null;
  }
}

/**
 * Health-check — send a simple ping and return latency + model info.
 * Used by the admin dashboard to verify the Hasab API key is valid.
 */
export async function pingHasab() {
  const start = Date.now();
  try {
    const j = await _hasabChatRaw('Reply with exactly: pong', {
      model: 'hasab-1-lite', temperature: 0, max_tokens: 8, stream: false, tools: null, timeout: 10000,
    });
    if (!j) return { ok: false, error: 'no response', latencyMs: Date.now() - start };
    return {
      ok: true,
      latencyMs: Date.now() - start,
      reply: (j.message?.content || '').trim().slice(0, 64),
      tokensUsed: j.usage?.total_tokens || 0,
      model: j.model || 'hasab-1-lite',
    };
  } catch (e) {
    return { ok: false, error: e.message, latencyMs: Date.now() - start };
  }
}
