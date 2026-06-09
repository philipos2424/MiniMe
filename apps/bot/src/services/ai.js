const OpenAI = require('openai');
const { intentDetectionPrompt, voiceAnalysisPrompt } = require('../../../../packages/shared/prompts');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function detectIntent(messageText, conversationHistory) {
  try {
    const historyText = (conversationHistory || [])
      .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Owner'}: ${m.content}`)
      .join('\n');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: intentDetectionPrompt() },
        { role: 'user', content: `Conversation:\n${historyText}\n\nNew message: \"${messageText}\"` },
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

function selectModel(intent, messageText) {
  const routineIntents = ['greeting', 'general', 'hours', 'location', 'faq', 'simple_query'];
  if (intent && routineIntents.includes(intent.toLowerCase())) {
    return 'gpt-4o-mini';
  }
  return 'gpt-4o';
}

async function generateReply(systemPrompt, conversationHistory, customerMessage, model) {
  try {
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const msg of conversationHistory) {
      messages.push({ role: msg.direction === 'inbound' ? 'user' : 'assistant', content: msg.content });
    }
    messages.push({ role: 'user', content: customerMessage });
    const response = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: 350,
      temperature: 0.78,
      presence_penalty: 0.3,
      frequency_penalty: 0.3,
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
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: voiceAnalysisPrompt() },
        { role: 'user', content: `Analyze these sample replies:\n\n${sampleReplies.map((r, i) => `${i + 1}. \"${r}\"`).join('\n')}` },
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

async function extractTasks(text, customerId) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a professional business coordinator. Analyze the text for commitments, promises, or action items. Return a JSON array: [{ "description": "string", "deadline": "ISO or null", "priority": 1-5, "is_commitment": boolean }].' },
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
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a relational scribe. Extract durable facts about the customer. Return a JSON array: [{ "text": "string", "category": "preference|logistics|personal|financial", "importance": 1-5 }]' },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.1,
    });
    const result = JSON.parse(response.choices[0].message.content);
    return result.facts || result.memories || [];
  } catch (error) {
    console.error('extractCustomerFacts error:', error.message);
    return null;
  }
}

async function summarizeConversation(messages) {
  try {
    const historyText = messages.map(m => `${m.direction === 'inbound' ? 'Customer' : 'Owner'}: ${m.content}`).join('\n');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Summarize this conversation for the owner. JSON: { "summary": "...", "outcome": "...", "next_step": "...", "mood": "..." }' },
        { role: 'user', content: `Conversation:\n${historyText}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.3,
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('summarizeConversation error:', error.message);
    return null;
  }
}

async function makeAgentDecision(intent, business) {
  return { action: 'draft', confidence: 0.8 };
}

async function enrichCustomer(customerId) {
  return { enriched: true };
}

async function generateOnboardingPersona(business) {
  const prompt = `Create a detailed buyer persona for ${business.name} (${business.category || 'General'}). Return strict JSON: { "persona_name": "...", "background": "...", "style": "...", "first_message": "..." }`;
  try {
    const res = await generateReply('You are a Persona Architect.', [], prompt, 'gpt-4o-mini');
    return JSON.parse(res);
  } catch (e) {
    return {
      persona_name: "Standard Prospect",
      background: "Curious client.",
      style: "Polite",
      first_message: "Hi! What do you specialize in?"
    };
  }
}

async function processScribeExtraction(text, currentState) {
  const prompt = `Update onboarding state for message: "${text}". State: ${JSON.stringify(currentState)}. Return JSON updated state.`;
  try {
    const res = await generateReply('You are a data extraction scribe.', [], prompt, 'gpt-4o-mini');
    return JSON.parse(res);
  } catch (e) {
    return currentState;
  }
}

module.exports = { 
  detectIntent, 
  selectModel, 
  generateReply, 
  analyzeVoiceProfile, 
  makeAgentDecision, 
  enrichCustomer, 
  extractTasks, 
  extractCustomerFacts, 
  summarizeConversation, 
  generateOnboardingPersona, 
  processScribeExtraction 
};
