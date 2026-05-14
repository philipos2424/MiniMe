/**
 * Lightweight intent detection (gpt-4o-mini, JSON mode).
 * Returns: { intent, sentiment, urgency, language, topics }
 */
import OpenAI from 'openai';
import { MODEL_MINI } from './constants';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

const SYSTEM_PROMPT = `You classify a single customer message for a small business bot.
Return ONLY JSON with this exact shape:
{
  "intent": "greeting" | "inquiry" | "order" | "negotiation" | "complaint" | "delivery" | "payment" | "thanks" | "general",
  "sentiment": "happy" | "neutral" | "interested" | "confused" | "frustrated" | "angry",
  "urgency": "low" | "medium" | "high",
  "language": "en" | "am" | "mixed",
  "topics": [string]
}`;

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
    console.warn('detectIntent:', e.message);
    return { intent: 'general', sentiment: 'neutral', urgency: 'medium', language: 'mixed', topics: [] };
  }
}
