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

function selectModel(/* intent, messageText */) {
  // Always use the strongest model for customer-facing replies.
  // Amharic fluency, voice fidelity, and emotional nuance matter more than
  // the small cost difference. gpt-4o-mini is reserved for cheap classification.
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

async function makeAgentDecision(systemPrompt) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: systemPrompt }],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.3,
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Agent decision error:', error.message);
    return { action: 'escalate', confidence: 0, decision: 'Error — escalating to owner', reasoning: error.message };
  }
}

async function enrichCustomer(messages) {
  try {
    const { customerEnrichmentPrompt } = require('../../../../packages/shared/prompts');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: customerEnrichmentPrompt() },
        { role: 'user', content: messages.map(m => m.content).join('\n') },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.3,
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Customer enrichment error:', error.message);
    return null;
  }
}

module.exports = { detectIntent, selectModel, generateReply, analyzeVoiceProfile, makeAgentDecision, enrichCustomer };
