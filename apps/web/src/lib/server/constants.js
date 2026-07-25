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
// General-purpose models — used by onboarding, advisor, search, teaching,
// document tagging, and everything else that isn't the live customer chat —
// gpt-4.1 family:
//   FAST  (<800ms)  — gpt-4.1-mini  — greetings, simple Q&A, no tools
//   SMART (~1.5s)   — gpt-4.1       — tool calling, orders, complex queries
//
// Chat (replyEngine + agent-bot webhook) has its own dedicated tier —
// gpt-5.5 family:
//   CHAT_MODEL_MINI — gpt-5.5-mini — fast path, simple replies
//   CHAT_MODEL      — gpt-5.5      — tool calling, orders, complex queries
//
// EMBED — text-embedding-3-small — knowledge retrieval
export const MODEL           = 'gpt-4.1';       // general brain + tool calls
export const MODEL_MINI      = 'gpt-4.1-mini';  // general fast path
export const CHAT_MODEL      = 'gpt-5.5';       // live chat brain + tool calls
export const CHAT_MODEL_MINI = 'gpt-5.5-mini';  // live chat fast path
export const EMBED_MODEL     = 'text-embedding-3-small';
