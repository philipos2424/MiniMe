/**
 * Lightweight intent detection (gpt-4o-mini, JSON mode).
 * Returns: { intent, sentiment, urgency, language, topics }
 */
import { makeOpenAI } from './openaiClient';
import { MODEL_MINI } from './constants';

const openai = makeOpenAI();

const SYSTEM_PROMPT = `You classify a single customer message for a small business bot.
Return ONLY JSON with this exact shape:
{
  "intent": "greeting" | "inquiry" | "order" | "negotiation" | "complaint" | "delivery" | "payment" | "thanks" | "general",
  "sentiment": "happy" | "neutral" | "interested" | "confused" | "frustrated" | "angry",
  "urgency": "low" | "medium" | "high",
  "language": "en" | "am" | "mixed",
  "topics": [string]
}`;

// ── Cheap pre-filter ────────────────────────────────────────────────────────
//
// A large share of real traffic is one-word acknowledgements — "Awo", "እሺ",
// "Amen amen", "ok", a lone 👍. Classifying those cost a full model call each,
// and the answer was never in doubt. Regex handles them for free.
//
// Deliberately conservative: it only matches messages that are ENTIRELY an
// ack/greeting/emoji. Anything with a question mark, a number, or extra words
// falls through to the model, because "ok how much for 3?" is a real inquiry.
// NOTE: no \b anywhere below. JavaScript's \b is defined over ASCII word
// characters only, so it never matches after an Ethiopic letter — "እሺ\b" fails
// against the string "እሺ", which silently excluded every Amharic ack, i.e.
// exactly the traffic this filter exists for. The patterns are anchored ^…$
// with a trailing [\s.!]* instead, which is a stricter whole-string match than
// \b gave us: "no" still matches "no." but not "nope" or "no this is broken".
const ACK_RE = /^(ok(ay)?|k|sure|fine|alright|got it|yes|yeah|yep|no|nope|awo|ayy?|እሺ|አዎ|አይ|ok+)[\s.!]*$/i;
const GREET_RE = /^(hi+|hello+|hey+|selam|salam|ሰላም|good (morning|afternoon|evening))[\s.!]*$/i;
const THANKS_RE = /^(thanks?|thank you|thx|ty|amen( amen)?|አመሰግናለሁ|እናመሰግናለን)[\s.!]*$/i;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s‍️]+$/u;

function triviallyClassifiable(text) {
  const t = (text || '').trim();
  if (!t || t.length > 24) return null;          // long enough to mean something
  if (/[?？]|\d/.test(t)) return null;            // a question or a quantity — ask the model

  const language = /[ሀ-፿]/.test(t) ? 'am' : 'en';
  const base = { sentiment: 'neutral', urgency: 'low', language, topics: [], _heuristic: true };

  if (EMOJI_ONLY_RE.test(t)) return { ...base, intent: 'general', sentiment: 'happy' };
  if (THANKS_RE.test(t))     return { ...base, intent: 'thanks',  sentiment: 'happy' };
  if (GREET_RE.test(t))      return { ...base, intent: 'greeting' };
  if (ACK_RE.test(t))        return { ...base, intent: 'general' };
  return null;
}

export async function detectIntent(messageText, conversationHistory = []) {
  const trivial = triviallyClassifiable(messageText);
  if (trivial) return trivial;

  try {
    const historyText = conversationHistory
      .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Owner'}: ${m.content}`)
      .join('\n');

    const resp = await openai.chat.completions.create({
      model: MODEL_MINI,
      response_format: { type: 'json_object' },
      max_tokens: 150,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Conversation so far:\n${historyText || '(none)'}\n\nNew message: "${messageText}"` },
      ],
    });
    return JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    console.error('[intent][WARN] detectIntent failed — flagging as unknown:', e.message);
    return { intent: 'unknown', sentiment: 'neutral', urgency: 'medium', language: 'mixed', topics: [], _error: true };
  }
}
