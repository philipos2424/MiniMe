const { selectModel, generateReply } = require('./ai');
const { replyDraftPrompt } = require('../../../../packages/shared/prompts');
const { findByBusiness: findProducts } = require('../../../../packages/db/queries/products');
const { getRecentMessages } = require('../../../../packages/db/queries/messages');
const { retrieveRelevantChunks } = require('./knowledge');
const { listForCustomer } = require('../../../../packages/db/queries/customerMemory');

async function draftReply(business, customer, conversation, message, intent) {
  try {
    const products = await findProducts(business.id);
    const history = await getRecentMessages(conversation.id, 10);
    const historyText = history.map(m => `${m.direction === 'inbound' ? 'Customer' : 'Owner'}: ${m.content}`).join('\n');
    const model = selectModel(intent, message.content);
    const voiceProfile = business.voice_embedding || {};

    // RAG: fetch knowledge-base chunks relevant to the customer's question
    let knowledgeBlock = '';
    try {
      const chunks = await retrieveRelevantChunks(message.content, business.id, { count: 4, threshold: 0.3 });
      if (chunks.length) {
        knowledgeBlock = '\n\n## KNOWLEDGE BASE (owner-uploaded docs — use as truth, but paraphrase in your voice):\n' +
          chunks.map((c, i) => `[KB-${i + 1}] ${c.content.slice(0, 600)}`).join('\n---\n');
      }
    } catch (e) { /* non-fatal */ }

    // Per-customer memory
    let memoryBlock = '';
    try {
      const mem = await listForCustomer(customer.id, 10);
      if (mem.length) {
        memoryBlock = '\n\n## WHAT YOU REMEMBER ABOUT THIS CUSTOMER:\n' +
          mem.map(m => `- (${m.kind}) ${m.content}`).join('\n');
      }
    } catch (e) { /* non-fatal */ }

    const basePrompt = replyDraftPrompt(business, voiceProfile, products, customer, historyText);
    const systemPrompt = basePrompt + knowledgeBlock + memoryBlock;
    const draft = await generateReply(systemPrompt, history, message.content, model);

    if (!draft) return { draft: null, confidence: 0, model };
    const confidence = calculateConfidence(draft, voiceProfile, intent, business);
    return { draft, confidence, model };
  } catch (error) {
    console.error('Draft reply error:', error.message);
    return { draft: null, confidence: 0, model: 'gpt-4o-mini' };
  }
}

function calculateConfidence(draft, voice, intent, business) {
  let score = 0.6;
  if (voice.greeting?.opener && draft.includes(voice.greeting.opener)) score += 0.1;
  if (['greeting', 'thanks'].includes(intent.intent)) score += 0.15;
  if (['complaint', 'negotiation'].includes(intent.intent)) score -= 0.15;
  if (draft.length < 200) score += 0.05;
  if (draft.length > 400) score -= 0.1;
  if ((business.sample_replies || []).length >= 20) score += 0.1;
  if ((business.sample_replies || []).length < 5) score -= 0.2;
  if (voice.uniquePhrases?.some(p => draft.includes(p))) score += 0.1;
  return Math.max(0.1, Math.min(0.99, score));
}

module.exports = { draftReply };
