// Mirror of packages/shared/constants.js (ESM, trimmed to what replyEngine needs).
export const TRUST_LEVELS = {
  SHADOW: 0,
  SUPERVISED: 1,
  TRUSTED: 2,
  FULL_AGENT: 3,
};

export const TRUST_LEVEL_NAMES = {
  0: { en: 'Shadow', am: 'ጥላ', emoji: '👁️' },
  1: { en: 'Supervised', am: 'ቁጥጥር', emoji: '✋' },
  2: { en: 'Trusted', am: 'ታማኝ', emoji: '🤝' },
  3: { en: 'Full Agent', am: 'ሙሉ ወኪል', emoji: '🚀' },
};

export const ROUTINE_INTENTS = ['greeting', 'inquiry', 'thanks', 'payment', 'delivery'];
export const COMPLEX_INTENTS = ['complaint', 'negotiation', 'order'];

// AI model versions — centralized so upgrades happen in one place.
//
// GPT-5.6 is the default family now:
//   FAST / low-latency  — gpt-5.6-terra — greetings, simple Q&A, lightweight extraction
//   SMART / heavy-duty  — gpt-5.6-sol   — tool calling, orders, complex conversations
//
// EMBED — text-embedding-3-small — knowledge retrieval
export const MODEL           = 'gpt-5.6-sol';    // general brain + tool calls
export const MODEL_MINI      = 'gpt-5.6-terra';  // general fast path
export const CHAT_MODEL      = 'gpt-5.6-sol';    // live chat brain + tool calls
export const CHAT_MODEL_MINI = 'gpt-5.6-terra';  // live chat fast path
export const EMBED_MODEL     = 'text-embedding-3-small';
