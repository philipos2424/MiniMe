/**
 * addisAIPrompts — pure prompt-building + response-parsing helpers for the
 * Addis AI client (addisAI.js). Split out so this logic can be unit-tested
 * with plain `node --test` (addisAI.js itself does I/O and isn't worth
 * testing beyond integration).
 */

// Addis AI's only documented endpoint (chat_generate) is conversational, not
// a raw transcription/translation API — so every task here is a prompt that
// steers the chat model into acting like one, with an explicit "no commentary"
// instruction. This is inherently less reliable than a dedicated STT/MT
// endpoint; addisAI.js treats any unexpected shape as a failure and lets the
// caller fall back to Whisper/GPT.

export function buildTranscriptionPrompt() {
  return 'TASK: Transcribe the following audio exactly as spoken, in its original language and script. '
    + 'Do not answer, translate, or add commentary. Output ONLY the raw transcript text, nothing else.';
}

const AMHARIC_TONE_HINT = 'Use everyday spoken Amharic like a friendly Addis shopkeeper texting on Telegram — NOT '
  + 'formal/written register, NOT translated-English-Amharic. Keep English business terms as-is (ETB, delivery, '
  + 'discount, brand names, prices in numerals). PRESERVE identity language exactly: if the source says "AI '
  + 'assistant" or "I\'m the assistant", the translation must keep that role — don\'t rephrase to make the speaker '
  + 'sound like the owner. Short (1-2 lines max), warm, natural.';

const LANG_NAMES = { am: 'Amharic', en: 'English', om: 'Afan Oromo' };

export function buildTranslationPrompt(text, sourceLang, targetLang) {
  const hint = targetLang === 'am' ? ` ${AMHARIC_TONE_HINT}` : '';
  const src = LANG_NAMES[sourceLang] || sourceLang;
  const dst = LANG_NAMES[targetLang] || targetLang;
  return `Translate the following ${src} text to ${dst}.${hint} Reply with ONLY the translation, nothing else.\n\n${String(text).slice(0, 2000)}`;
}

/** 'auto' | 'amh' | 'eng' (Hasab-era codes, kept for call-site compatibility) → Addis AI's target_language code. */
export function mapLanguage(code) {
  if (code === 'amh') return 'am';
  if (code === 'eng') return 'en';
  return undefined; // 'auto' / unknown — omit and let the model infer
}

/**
 * Addis AI's exact response field name isn't independently verifiable (docs
 * are bot-gated), so pull text from any plausible shape rather than
 * hard-coding one field and failing outright on a mismatch.
 */
export function extractResponseText(json) {
  if (!json || typeof json !== 'object') return '';
  const candidates = [
    json.responseText, json.response_text, json.text, json.message,
    json.reply, json.output, json.data?.responseText, json.data?.text,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}
