const { openai, resolveModel } = require('./aiClient');

function intentDetectionPrompt() {
  return `You classify customer messages for Ethiopian businesses on Telegram.
Return ONLY a valid JSON object with the following schema:
{
  "intent": "greeting|catalog|order|general|amharic|pricing|location|hours|faq|support",
  "sentiment": "positive|neutral|negative",
  "urgency": "low|medium|high",
  "language": "am|en|mixed",
  "topics": []
}`;
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
  const heavyIntents = new Set(['order', 'pricing', 'support', 'complaint', 'negotiation', 'financial', 'legal']);
  const lightIntent = new Set(['greeting', 'thanks', 'general']);

  if (/^(hi+|hello+|hey+|hii+|good morning|good afternoon|good evening|selam|ሰላም|salam)\b/.test(text)) {
    return resolveModel('gpt-5.5');
  }

  if (heavyIntents.has(intent?.intent) || (!lightIntent.has(intent?.intent) && text.length > 40)) {
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
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Intent detection error:', error.message);
    return { intent: 'general', sentiment: 'neutral', urgency: 'medium', language: 'mixed', topics: [] };
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
};
