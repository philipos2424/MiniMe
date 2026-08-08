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

// The exact vocabulary intent.js is allowed to emit. Any branch that tests a
// value outside these lists is dead code — notification.js used to check for
// sentiment === 'negative', which the classifier never returns, so upset
// customers never triggered an owner ping.
// Note: intent.js also returns 'unknown' (with _error: true) when the
// classifier call itself fails — it is a failure marker, not a classification,
// so it is deliberately excluded here. Branch on it explicitly if you need it.
export const INTENT_VALUES = [
  'greeting', 'inquiry', 'order', 'negotiation', 'complaint',
  'delivery', 'payment', 'thanks', 'general',
];
export const SENTIMENT_VALUES = [
  'happy', 'neutral', 'interested', 'confused', 'frustrated', 'angry',
];
export const NEGATIVE_SENTIMENTS = ['frustrated', 'angry'];
export const POSITIVE_SENTIMENTS = ['happy', 'interested'];

// Intents that should interrupt the owner immediately.
//
// Deliberately NOT the same list as COMPLEX_INTENTS. "Needs more reasoning
// budget / lower auto-send confidence" (COMPLEX_INTENTS) is a different
// question from "buzz the owner's phone right now" — COMPLEX_INTENTS includes
// 'order', and paging an owner on every single order is a notification-volume
// change nobody asked for. This list preserves the set that was *effectively*
// live before the dead entries ('urgent','refund','problem','issue') were
// removed from notification.js.
export const URGENT_INTENTS = ['complaint', 'negotiation'];

// AI model versions — centralized so upgrades happen in one place.
//
// GPT-5.5 is the default family now. Note: "gpt-5.5-pro" is not a valid
// chat-completions model on the OpenAI API (404s every call) — use gpt-5.5
// for both tiers until a real "pro" tier ID is confirmed.
//
// DO NOT downgrade these to gpt-5.4-mini / -nano to save money. Amharic reply
// quality is the product, and the cheaper tiers are measurably worse at it.
// Cost is controlled through reasoning effort (below), not model choice.
// Cheaper models are only on the table for non-conversational, non-Amharic
// paths (onboarding extraction, auto-tagging) and that is a separate decision.
//
// EMBED — text-embedding-3-small — knowledge retrieval
export const MODEL           = 'gpt-5.5';    // general brain + tool calls
export const MODEL_MINI      = 'gpt-5.5';    // general fast path
export const CHAT_MODEL      = 'gpt-5.5';    // live chat brain + tool calls
export const CHAT_MODEL_MINI = 'gpt-5.5';    // live chat fast path
export const EMBED_MODEL     = 'text-embedding-3-small';

// ── Reasoning effort — the actual cost lever ────────────────────────────────
//
// gpt-5.x spends hidden "reasoning tokens" before the visible reply, billed at
// output rates. Nothing in this codebase used to set this, so every call — down
// to a one-word YES/NO gate — paid for reasoning it didn't need.
//
// Measured against the live API on gpt-5.5 (8 real Amharic customer messages
// through the reply prompt):
//   default : 755 reasoning + 1227 completion tokens
//   'low'   : 419 reasoning +  852   — erratic, and it invented a discount price
//   'none'  :   0 reasoning +  408   — replies shorter, more human, prices exact
//
// So 'none' is both the cheapest AND the best-behaved for conversation.
//
// It is applied CENTRALLY, as the default for every gpt-5 chat call, in
// sanitizeForRealOpenAI (openaiClient.js) — not per call site. That covers all
// ~60 call sites at once, including the ~41 that bypass loggedCompletion, and
// means a new call site is cheap by default instead of expensive by default.
//
// Call sites that genuinely need reasoning opt out by passing reasoning_effort
// explicitly. Only the tool-calling loops do (agentBrain, teamBrain), where
// picking the right tool across iterations is a real multi-step decision.
//
// NOTE: 'minimal' is NOT a valid value on gpt-5.5 (400s). The API accepts
// exactly: 'none', 'low', 'medium', 'high', 'xhigh'.
export const EFFORT_BRAIN = 'low';
