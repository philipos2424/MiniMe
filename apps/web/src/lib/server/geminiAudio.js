/**
 * Speech-to-text through Gemini's native generateContent API.
 *
 * Replaces Whisper as the fallback behind Addis AI (and as the only engine
 * for Market voice search): Whisper needs OpenAI credits, which ran out, so
 * every voice note that Addis AI couldn't handle came back empty. Gemini
 * sniffs the container itself — Telegram OGG/Opus, browser WebM, MP4/M4A,
 * WAV all transcribe — and handles Amharic in Ge'ez script.
 *
 * The OpenAI-compat endpoint only takes wav/mp3 `input_audio`, so this calls
 * the native API directly with inline base64 (fine for voice notes; the
 * inline limit is 20MB per request).
 */

// Telegram reports whole seconds; a 0s voice note is a mis-tap, and silence is
// exactly where the model is most likely to hallucinate a transcript.
export const MIN_VOICE_SECONDS = 1;

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

// Asking for a yes/no speech verdict first (JSON) is what keeps silence from
// being "transcribed": with a plain transcribe prompt a silent clip came back
// as invented Amharic ("እሺ ጌታዬ አመሰግናለሁ") every time. More thinking made it
// worse, not better (6/6 silent clips got invented English at 'low').
const PROMPT = 'First decide whether the audio contains clearly audible human speech. '
  + 'Return JSON {"has_speech": boolean, "transcript": string}. '
  + 'If has_speech is false, transcript must be "". If true, transcript is exactly what was said, '
  + "in the spoken language and its usual script (Amharic in Ge'ez script, Afaan Oromo in Latin script, "
  + 'English, or a mix). No translation or commentary. Never invent words.';

/**
 * @param {Buffer} buf   audio bytes
 * @param {string} mime  e.g. 'audio/ogg', 'audio/webm' — a best guess is fine
 * Callers should skip sub-second clips themselves (see MIN_VOICE_SECONDS).
 * @returns {Promise<string|null>} transcript, or null when unavailable/empty
 */
export async function transcribeWithGemini(buf, mime = 'audio/ogg') {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !buf?.length) return null;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mime, data: buf.toString('base64') } },
        ],
      }],
      // Same reason as withGeminiThinking(): default thinking eats the output budget.
      generationConfig: {
        thinkingConfig: { thinkingLevel: 'minimal' },
        maxOutputTokens: 2048,
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`gemini transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  let out;
  try { out = JSON.parse(raw); } catch { return null; }
  const text = typeof out?.transcript === 'string' ? out.transcript.trim() : '';
  return out?.has_speech && text ? text : null;
}
