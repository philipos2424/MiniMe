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
// Speed tier guide:
//   FAST  (<800ms)  — gpt-4.1-mini  — greetings, simple Q&A, no tools
//   SMART (~1.5s)   — gpt-4.1       — tool calling, orders, complex queries
//   EMBED           — text-embedding-3-small — knowledge retrieval
//
// gpt-4.1 is the main model. gpt-4.1-mini is used for the fast path.
export const MODEL        = 'gpt-4.1';       // brain + tool calls
export const MODEL_MINI   = 'gpt-4.1-mini';  // fast path — simple replies
export const EMBED_MODEL  = 'text-embedding-3-small';
