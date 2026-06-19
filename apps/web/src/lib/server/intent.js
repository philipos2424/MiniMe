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
  "topics": [string],
  "is_emergency": true | false
}
Set "is_emergency" true ONLY for a real, urgent crisis happening now (accident, injury, medical emergency, violence, fire, immediate danger, or a genuine plea for help) — not jokes, exaggerations ("traffic is killing me"), or marketing ("emergency sale").`;

export async function detectIntent(messageText, conversationHistory = []) {
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
    return { intent: 'unknown', sentiment: 'neutral', urgency: 'medium', language: 'mixed', topics: [], is_emergency: false, _error: true };
  }
}
