/**
 * Addis AI API client — Amharic/Afan Oromo-first NLP for MiniMe.
 *
 * Base URL: https://api.addisassistant.com/api/v1
 * Auth: Bearer token (ADDIS_AI_API_KEY env var)
 * Endpoint: POST /chat_generate — text (JSON) or audio (multipart, field
 *   `chat_audio_input`). It's a conversational endpoint, not a dedicated
 *   transcription/translation API, so transcribeWithAddisAI/translate* steer
 *   it with an explicit "output only the raw result" instruction — see
 *   addisAIPrompts.mjs. The exact response field name isn't independently
 *   verifiable (the docs page is bot-gated), so responses are parsed
 *   defensively; every function returns null on any failure or unexpected
 *   shape so callers fall back to Whisper/GPT (this file replaces the
 *   previous Hasab AI integration one-for-one for that reason).
 *
 * Used for:
 *   1. transcribeWithAddisAI() — transcribe Amharic/Afan Oromo voice messages
 *   2. translateToAmharic()    — translate English text → Amharic
 *   3. translateFromAmharic()  — translate Amharic text → English
 *   4. chatWithAddisAI()       — ask Addis AI's model a question directly
 */
import { buildTranscriptionPrompt, buildTranslationPrompt, mapLanguage, extractResponseText } from './addisAIPrompts.mjs';

const ADDIS_BASE = 'https://api.addisassistant.com/api/v1';
const ADDIS_KEY = process.env.ADDIS_AI_API_KEY;

function authHeaders() {
  return { Authorization: `Bearer ${ADDIS_KEY}` };
}

/**
 * Low-level call to /chat_generate. Text-only when no audioBuffer is given,
 * multipart/form-data (with `chat_audio_input`) otherwise.
 * @returns {string} extracted response text, or '' if nothing usable came back
 */
async function chatGenerate({ prompt, targetLanguage, audioBuffer, ext, timeout = 20000 }) {
  if (!ADDIS_KEY) return '';

  let res;
  if (audioBuffer) {
    const form = new FormData();
    const mime = ext === 'ogg' ? 'audio/ogg' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    form.append('chat_audio_input', new Blob([audioBuffer], { type: mime }), `voice.${ext}`);
    form.append('prompt', prompt);
    if (targetLanguage) form.append('target_language', targetLanguage);
    res = await fetch(`${ADDIS_BASE}/chat_generate`, {
      method: 'POST', headers: authHeaders(), body: form, signal: AbortSignal.timeout(timeout),
    });
  } else {
    const body = { prompt };
    if (targetLanguage) body.target_language = targetLanguage;
    res = await fetch(`${ADDIS_BASE}/chat_generate`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => String(res.status));
    console.warn(`[AddisAI] chat_generate ${res.status}:`, txt.slice(0, 200));
    return '';
  }
  return extractResponseText(await res.json());
}

/**
 * Transcribe a Telegram voice/audio file (optimised for Amharic/Afan Oromo).
 * Returns null on any error so the caller falls back to Whisper.
 *
 * @param {Buffer} audioBuffer
 * @param {string} ext — 'ogg' | 'mp3' | 'mp4'
 * @param {object} opts
 * @param {string} opts.language  — 'amh' | 'eng' | 'auto'
 * @param {boolean} opts.translate — also return an English translation
 * @returns {{ text: string, translation?: string|null, durationSeconds: null } | null}
 */
export async function transcribeWithAddisAI(audioBuffer, ext, { language = 'auto', translate = false } = {}) {
  try {
    const text = await chatGenerate({
      prompt: buildTranscriptionPrompt(),
      targetLanguage: mapLanguage(language),
      audioBuffer, ext,
      timeout: 45000,
    });
    if (!text) return null;

    let translation = null;
    if (translate) {
      try {
        translation = (await chatGenerate({
          prompt: buildTranslationPrompt(text, 'am', 'en'),
          targetLanguage: 'en',
          timeout: 15000,
        })) || null;
      } catch (e) { console.warn('[AddisAI] transcript translation failed:', e.message); }
    }

    // Duration isn't returned by this endpoint; caller falls back to the
    // Telegram media object's own duration field.
    return { text, translation, durationSeconds: null };
  } catch (e) {
    console.warn('[AddisAI] transcribeWithAddisAI:', e.message);
    return null;
  }
}

/** Translate English → Amharic. Returns null on failure. */
export async function translateToAmharic(text) {
  if (!text?.trim()) return null;
  try {
    return (await chatGenerate({
      prompt: buildTranslationPrompt(text, 'en', 'am'),
      targetLanguage: 'am',
      timeout: 12000,
    })) || null;
  } catch (e) {
    console.warn('[AddisAI] translateToAmharic:', e.message);
    return null;
  }
}

/** Translate Amharic → English. Returns null on failure. */
export async function translateFromAmharic(text) {
  if (!text?.trim()) return null;
  try {
    return (await chatGenerate({
      prompt: buildTranslationPrompt(text, 'am', 'en'),
      targetLanguage: 'en',
      timeout: 12000,
    })) || null;
  } catch (e) {
    console.warn('[AddisAI] translateFromAmharic:', e.message);
    return null;
  }
}

/**
 * Ask Addis AI's model a question directly.
 * @returns {{ content: string, tokensUsed: number, model: string } | null}
 */
export async function chatWithAddisAI(message, { targetLanguage = 'am' } = {}) {
  try {
    const content = await chatGenerate({ prompt: String(message).slice(0, 8000), targetLanguage, timeout: 20000 });
    if (!content) return null;
    // Token usage isn't documented for this endpoint.
    return { content, tokensUsed: 0, model: 'addis-ai' };
  } catch (e) {
    console.warn('[AddisAI] chatWithAddisAI:', e.message);
    return null;
  }
}

/** Health-check — used by the admin Platform Health tab. */
export async function pingAddisAI() {
  const start = Date.now();
  try {
    const content = await chatGenerate({ prompt: 'Reply with exactly: pong', targetLanguage: 'en', timeout: 10000 });
    if (!content) return { ok: false, error: 'no response', latencyMs: Date.now() - start };
    return { ok: true, latencyMs: Date.now() - start, reply: content.slice(0, 64), model: 'addis-ai' };
  } catch (e) {
    return { ok: false, error: e.message, latencyMs: Date.now() - start };
  }
}
