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
// GPT-5.5 is the default family now. Note: "gpt-5.5-pro" is not a valid
// chat-completions model on the OpenAI API (404s every call) — use gpt-5.5
// for both tiers until a real "pro" tier ID is confirmed.
//
// EMBED — text-embedding-3-small — knowledge retrieval
export const MODEL           = 'gpt-5.5';    // general brain + tool calls
export const MODEL_MINI      = 'gpt-5.5';    // general fast path
export const CHAT_MODEL      = 'gpt-5.5';    // live chat brain + tool calls
export const CHAT_MODEL_MINI = 'gpt-5.5';    // live chat fast path
export const EMBED_MODEL     = 'text-embedding-3-small';
