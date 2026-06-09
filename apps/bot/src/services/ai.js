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

function selectModel(intent, messageText) {
  // Define routine intents that can be handled by the faster/cheaper mini model
  const routineIntents = ['greeting', 'general', 'hours', 'location', 'faq', 'simple_query'];
  
  if (intent && routineIntents.includes(intent.toLowerCase())) {
    return 'gpt-4o-mini';
  }

  // For everything else: complex negotiations, financial discussions, or low-confidence cases, use the full model
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

async function extractTasks(text, customerId) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a professional business coordinator. Analyze the text for commitments, promises, or action items that the business owner needs to handle. Extract these as a JSON array of objects: [{ "description": "string", "deadline": "ISO timestamp or null", "priority": 1-5, "is_commitment": boolean }]. Only extract items that require a future action. If none, return { "tasks": [] }.' 
        },
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
        { 
          role: 'system', 
          content: 'You are a relational scribe. Extract durable facts about the customer from the text. Only extract facts that are useful for future conversations (e.g. preferences, locations, family, specific needs, constraints). Ignore temporary chat noise. Return a JSON array of objects: [{ "text": "string", "category": "preference|logistics|personal|financial", "importance": 1-5 }]' 
        },
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
    const historyText = messages
      .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Owner'}: ${m.content}`)
      .join('\\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a top-tier executive secretary. Summarize the provided conversation for the business owner. Be concise and ultra-practical. Format as JSON: { "summary": "brief gist of the chat", "outcome": "current state of the interaction", "next_step": "clear, actionable instruction for the owner", "mood": "customer sentiment" }' 
        },
        { role: 'user', content: `Conversation:\\n${historyText}` },
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

module.exports = { detectIntent, selectModel, generateReply, analyzeVoiceProfile, makeAgentDecision, enrichCustomer, extractTasks, extractCustomerFacts, summarizeConversation };


/**
 * PERSONA ENGINE: Dynamic Customer Generation
 * Generates a realistic buyer persona based on the business data.
 */
async function generateOnboardingPersona(business) {
  const { generateResponse } = require('./ai'); // Assuming generateResponse is already there
  
  const prompt = `
    You are a "Customer Persona Generator" for MiniMe. 
    Business Name: ${business.name}
    Category: ${business.category || 'General'}
    
    Task: Create a high-fidelity buyer persona that would be a "Dream Client" for this business.
    Requirements:
    1. Name and Background (e.g., 'Sami, a high-net-worth collector from Dubai').
    2. Specific motivations (Why are they looking for this service/product?).
    3. Communication style (Skeptical, hurried, elegant, etc.).
    4. A "First Hook" message: The first message the AI will send to the business owner to start the simulation.

    Return the response in strict JSON format:
    {
      "persona_name": "...",
      "background": "...",
      "style": "...",
      "first_message": "..."
    }
  `;
  
  try {
    const res = await generateResponse({ query: prompt, persona: "Persona Architect" });
    return JSON.parse(res);
  } catch (e) {
    return {
      persona_name: "Standard Prospect",
      background: "A curious client interested in your services.",
      style: "Polite and inquisitive",
      first_message: "Hi! I just found your business and I'm curious—what do you specialize in?"
    };
  }
}

/**
 * THE SCRIBE: Real-time Data Extraction
 * Analyzes the chat to see which 'slots' are now filled.
 */
async function processScribeExtraction(text, currentState) {
  const prompt = `
    You are the MiniMe Scribe. Your job is to extract structured business data from a casual conversation.
    
    Current State: ${JSON.stringify(currentState)}
    User Message: "${text}"
    
    Analyze the message and update the state.
    - If the user mentioned their business name -> mark 'business_name' as captured.
    - If they mentioned a price or product -> mark 'price_list' as captured.
    - If they are speaking naturally, analyze the tone for 'voice_profile'.
    
    Return a JSON object with the updated 'captured' and 'missing' lists.
  `;
  
  try {
    const res = await generateResponse({ query: prompt, persona: "Scribe" });
    return JSON.parse(res);
  } catch (e) {
    return currentState;
  }
}

module.exports = { 
  ...module.exports, 
  generateOnboardingPersona, 
  processScribeExtraction 
};
