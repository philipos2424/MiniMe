const TRUST_LEVELS = {
  SHADOW: 0,
  SUPERVISED: 1,
  TRUSTED: 2,
  FULL_AGENT: 3,
};

const TRUST_LEVEL_NAMES = {
  0: { en: 'Shadow', am: 'ጥላ', emoji: '👁️', color: '#6B7280' },
  1: { en: 'Supervised', am: 'ቁጥጥር', emoji: '✋', color: '#D97706' },
  2: { en: 'Trusted', am: 'ታማኝ', emoji: '🤝', color: '#059669' },
  3: { en: 'Full Agent', am: 'ሙሉ ወኪል', emoji: '🚀', color: '#7C3AED' },
};

const INTENTS = {
  GREETING: 'greeting',
  INQUIRY: 'inquiry',
  ORDER: 'order',
  NEGOTIATION: 'negotiation',
  COMPLAINT: 'complaint',
  DELIVERY: 'delivery',
  PAYMENT: 'payment',
  THANKS: 'thanks',
  GENERAL: 'general',
};

const ROUTINE_INTENTS = ['greeting', 'inquiry', 'thanks', 'payment', 'delivery'];
const COMPLEX_INTENTS = ['complaint', 'negotiation', 'order'];

const SENTIMENTS = {
  HAPPY: 'happy',
  NEUTRAL: 'neutral',
  INTERESTED: 'interested',
  CONFUSED: 'confused',
  FRUSTRATED: 'frustrated',
  ANGRY: 'angry',
};

// The exact vocabularies the classifier is allowed to emit.
//
// These are built FROM the maps above so a classifier prompt can never drift
// away from the branches that consume it. Previously the prompt hardcoded its
// own list ("positive|neutral|negative", "catalog|faq|support"), which meant
// the angry-customer handoff, the routine auto-send path, the CRM sentiment
// score and the analytics counters all silently matched nothing.
const INTENT_VALUES = Object.values(INTENTS);
const SENTIMENT_VALUES = Object.values(SENTIMENTS);
const URGENCY_VALUES = ['low', 'medium', 'high'];
const LANGUAGE_VALUES = ['en', 'am', 'mixed'];

// Sentiments that mean "a human needs to take over now".
const NEGATIVE_SENTIMENTS = [SENTIMENTS.FRUSTRATED, SENTIMENTS.ANGRY];
// Sentiments that count as a good interaction in analytics.
const POSITIVE_SENTIMENTS = [SENTIMENTS.HAPPY, SENTIMENTS.INTERESTED];

// Intents that mean the customer is wrapping up — triggers the closing summary.
const CLOSING_INTENTS = [INTENTS.THANKS];

// Agent task statuses that represent work that is still open. Used to
// deduplicate cron-created tasks; a task in any of these states means we
// should NOT create a second one for the same product/payment/customer.
const OPEN_TASK_STATUSES = ['pending', 'awaiting_approval', 'scheduled', 'in_progress'];

/** Formats a value list as a JSON-schema-ish enum for embedding in a prompt. */
function enumForPrompt(values) {
  return values.map(v => `"${v}"`).join(' | ');
}

const CUSTOMER_TIERS = {
  NEW: 'new',
  REGULAR: 'regular',
  VIP: 'vip',
};

const ONBOARDING_QUESTIONS = [
  {
    id: 'business_name',
    question: '🏪 What is your business name?',
    question_am: 'የንግድ ስምዎ ምንድነው?',
    example: 'Example: iConnect Digital Cards',
    type: 'text',
  },
  {
    id: 'business_category',
    question: '📦 What does your business sell or do?',
    question_am: 'ንግድዎ ምን ይሸጣል ወይም ምን ያደርጋል?',
    example: 'Example: Digital business cards, NFC products',
    type: 'text',
  },
  {
    id: 'greeting',
    question: '👋 How do you usually greet customers? Send me 2-3 examples of your typical opening message.',
    question_am: 'ደንበኞችን እንዴት ነው የሚቀበሏቸው?',
    example: 'Example: "ሰላም! እንኳን ደህና መጡ! How can I help you today?"',
    type: 'voice_sample',
  },
  {
    id: 'pricing',
    question: '💰 How do you tell customers about pricing? Send 2-3 examples.',
    question_am: 'ስለ ዋጋ ለደንበኞች እንዴት ይነግራሉ?',
    example: 'Example: "The NFC card is 500 birr. For 5+, I can do 400 each."',
    type: 'voice_sample',
  },
  {
    id: 'out_of_stock',
    question: '📭 What do you say when something is out of stock?',
    question_am: 'ዕቃ ሲያልቅ ምን ይላሉ?',
    example: "Example: \"Sorry, that's finished right now. I can let you know when it's back!\"",
    type: 'voice_sample',
  },
  {
    id: 'closing',
    question: '🤝 How do you close a sale or end a conversation?',
    question_am: 'ሽያጭ ሲጨርሱ ምን ይላሉ?',
    example: "Example: \"Perfect! I'll prepare your order. Telebirr? 🙏\"",
    type: 'voice_sample',
  },
  {
    id: 'complaint',
    question: '😟 How do you handle an unhappy customer?',
    question_am: 'ያልተደሰተ ደንበኛ እንዴት ይያዛሉ?',
    example: "Example: \"I'm really sorry about that. Let me fix this right away...\"",
    type: 'voice_sample',
  },
  {
    id: 'negotiation',
    question: '🤔 How do you handle price negotiations? What discounts can you offer?',
    question_am: 'ስለ ዋጋ ድርድር እንዴት ያደርጋሉ?',
    example: "Example: \"For bulk orders I can do 10% off. That's my best price.\"",
    type: 'voice_sample',
  },
];

const PLANS = {
  trial: { price: 0, duration_days: 14, name: 'Free Trial' },
  // Price mirrors packages/shared/plan.js PRO_PRICE_ETB.
  pro: { price: 1999, duration_days: 30, name: 'MiniMe Pro', currency: 'ETB' },
};

module.exports = {
  TRUST_LEVELS, TRUST_LEVEL_NAMES, INTENTS, ROUTINE_INTENTS, COMPLEX_INTENTS,
  SENTIMENTS, CUSTOMER_TIERS, ONBOARDING_QUESTIONS, PLANS,
  INTENT_VALUES, SENTIMENT_VALUES, URGENCY_VALUES, LANGUAGE_VALUES,
  NEGATIVE_SENTIMENTS, POSITIVE_SENTIMENTS, CLOSING_INTENTS,
  OPEN_TASK_STATUSES, enumForPrompt,
};
