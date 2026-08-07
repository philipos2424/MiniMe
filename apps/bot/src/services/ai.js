const { openai, resolveModel } = require('./aiClient');
const {
  INTENTS, SENTIMENTS, INTENT_VALUES, SENTIMENT_VALUES,
  URGENCY_VALUES, LANGUAGE_VALUES, COMPLEX_INTENTS, ROUTINE_INTENTS,
  enumForPrompt,
} = require('../../../../packages/shared/constants');

// The enum values come straight from packages/shared/constants so this prompt
// can never drift from the code that branches on its output.
function intentDetectionPrompt() {
  return `You classify customer messages for Ethiopian businesses on Telegram.
Return ONLY a valid JSON object with the following schema:
{
  "intent": ${enumForPrompt(INTENT_VALUES)},
  "sentiment": ${enumForPrompt(SENTIMENT_VALUES)},
  "urgency": ${enumForPrompt(URGENCY_VALUES)},
  "language": ${enumForPrompt(LANGUAGE_VALUES)},
  "topics": [string]
}`;
}

// The model can still hallucinate a value outside the enum. Anything we don't
// recognise collapses to a safe default rather than silently failing to match
// any downstream branch.
//
// Crucially this also FLAGS the coercion. Without a marker, a total classifier
// failure produces {intent:'general', sentiment:'neutral'} — byte-identical to
// a genuine neutral message. 'general' is a light intent and 'neutral' is not
// negative, so calculateConfidence applies no penalty and a message the AI
// never understood can score high enough to auto-send at TRUSTED.
// `_error` (hard failure) and `_coerced` (out-of-enum values) let the reply
// path treat "I don't know" as the low-confidence signal it is.
function coerceIntent(raw, { failed = false } = {}) {
  const out = raw && typeof raw === 'object' ? raw : {};
  const coerced = [];

  const pick = (field, values, fallback) => {
    if (values.includes(out[field])) return out[field];
    if (out[field] !== undefined) coerced.push(`${field}=${JSON.stringify(out[field])}`);
    return fallback;
  };

  const result = {
    intent: pick('intent', INTENT_VALUES, INTENTS.GENERAL),
    sentiment: pick('sentiment', SENTIMENT_VALUES, SENTIMENTS.NEUTRAL),
    urgency: pick('urgency', URGENCY_VALUES, 'medium'),
    language: pick('language', LANGUAGE_VALUES, 'mixed'),
    topics: Array.isArray(out.topics) ? out.topics : [],
  };

  if (failed) result._error = true;
  if (coerced.length) {
    result._coerced = coerced;
    // Loud on purpose: silent coercion would hide real prompt drift, which is
    // the exact failure mode the shared vocabulary was introduced to end.
    console.warn(`detectIntent returned out-of-enum values: ${coerced.join(', ')}`);
  }
  return result;
}

function voiceAnalysisPrompt() {
  return `You analyze customer service replies to build a brand voice profile.
Return ONLY a valid JSON object:
{
  "formality": 1-5,
  "emojiUsage": "none|minimal|frequent",
  "tone": "friendly|formal|concise",
  "primaryLang": "am|en|mixed"
}`;
}

function selectModel(intent, messageText) {
  const text = `${messageText || ''}`.toLowerCase();
  // COMPLEX_INTENTS = complaint | negotiation | order — the ones worth extra
  // reasoning budget. Previously this set listed intents ("pricing", "support",
  // "financial", "legal") the classifier could never emit, so it never matched.
  const heavyIntents = new Set(COMPLEX_INTENTS);
  const lightIntents = new Set([...ROUTINE_INTENTS, INTENTS.GENERAL]);

  if (/^(hi+|hello+|hey+|hii+|good morning|good afternoon|good evening|selam|ሰላም|salam)\b/.test(text)) {
    return resolveModel('gpt-5.5');
  }

  if (heavyIntents.has(intent?.intent) || (!lightIntents.has(intent?.intent) && text.length > 40)) {
    // Note: there is no working "pro" chat tier today (gpt-5.5-pro is not a
    // chat model), so both branches resolve to gpt-5.5. Kept as a seam for
    // when a real higher tier ships.
    return resolveModel('gpt-5.5-pro');
  }

  return resolveModel('gpt-5.5');
}

async function detectIntent(messageText, conversationHistory) {
  try {
    const historyText = (conversationHistory || [])
      .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Owner'}: ${m.content}`)
      .join('\n');
    const response = await openai.chat.completions.create({
      model: resolveModel('gpt-5.5'),
      messages: [
        { role: 'system', content: intentDetectionPrompt() },
        { role: 'user', content: `Conversation:\n${historyText}\n\nNew message: "${messageText}"` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 150,
      temperature: 0.3,
    });
    return coerceIntent(JSON.parse(response.choices[0].message.content));
  } catch (error) {
    console.error('Intent detection error:', error.message);
    return coerceIntent(null, { failed: true });
  }
}

/**
 * Short owner-facing recap of a conversation, used when a customer signs off.
 * message.js has been calling this since the closing-summary feature landed,
 * but it was never actually implemented here — the require threw and the
 * surrounding try/catch swallowed it, so no summary was ever sent.
 */
async function summarizeConversation(conversationHistory) {
  try {
    const history = (conversationHistory || [])
      .map(m => `${m.direction === 'inbound' ? 'Customer' : 'You'}: ${m.content}`)
      .join('\n');
    if (!history.trim()) return null;

    const response = await openai.chat.completions.create({
      model: resolveModel('gpt-5.5'),
      messages: [
        {
          role: 'system',
          content: `You brief a busy Ethiopian business owner on a conversation that just ended.
Write 2-3 short lines, plain text, no headers and no markdown:
1. What the customer wanted.
2. What was agreed or promised (amounts, dates, quantities — be exact).
3. Any open action left for the owner, or "Nothing pending".
Be factual. Never invent details that are not in the transcript.`,
        },
        { role: 'user', content: history },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });
    return response.choices[0].message.content.trim() || null;
  } catch (error) {
    console.error('summarizeConversation error:', error.message);
    return null;
  }
}

async function generateReply(systemPrompt, conversationHistory, customerMessage, model) {
  try {
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const msg of conversationHistory) {
      messages.push({ role: msg.direction === 'inbound' ? 'user' : 'assistant', content: msg.content });
    }
    messages.push({ role: 'user', content: customerMessage });
    const response = await openai.chat.completions.create({
      model: resolveModel(model || 'gpt-5.5'),
      messages,
      max_tokens: 350,
      temperature: 0.78,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Reply generation error:', error.message);
    return null;
  }
}

async function analyzeVoiceProfile(sampleReplies) {
  try {
    const response = await openai.chat.completions.create({
      model: resolveModel('gpt-5.5'),
      messages: [
        { role: 'system', content: voiceAnalysisPrompt() },
        { role: 'user', content: `Analyze these sample replies:\n\n${sampleReplies.map((r, i) => `${i + 1}. "${r}"`).join('\n')}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 800,
      temperature: 0.3,
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Voice analysis error:', error.message);
    return null;
  }
}

async function extractTasks(text) {
  try {
    const response = await openai.chat.completions.create({
      model: resolveModel('gpt-5.5'),
      messages: [
        { role: 'system', content: 'You are a professional business coordinator. Analyze the text for commitments, promises, or action items. Return a JSON object with key "tasks": [{ "description": "string", "deadline": "ISO or null", "priority": 1-5, "is_commitment": boolean }].' },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 400,
      temperature: 0.1,
    });
    const result = JSON.parse(response.choices[0].message.content);
    return result.tasks || [];
  } catch (error) {
    console.error('extractTasks error:', error.message);
    return null;
  }
}

async function extractCustomerFacts(text) {
  try {
    const response = await openai.chat.completions.create({
      model: resolveModel('gpt-5.5'),
      messages: [
        { role: 'system', content: 'You are a relational scribe. Extract durable facts about the customer. Return a JSON object with key "facts": [{ "text": "string", "category": "preference|logistics|personal|financial", "importance": 1-5 }]' },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 400,
      temperature: 0.1,
    });
    const result = JSON.parse(response.choices[0].message.content);
    return result.facts || [];
  } catch (error) {
    console.error('extractCustomerFacts error:', error.message);
    return null;
  }
}

module.exports = {
  detectIntent,
  selectModel,
  generateReply,
  analyzeVoiceProfile,
  extractTasks,
  extractCustomerFacts,
  summarizeConversation,
};
