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
  pro: { price: 2500, duration_days: 30, name: 'MiniMe Pro', currency: 'ETB' },
};

module.exports = {
  TRUST_LEVELS, TRUST_LEVEL_NAMES, INTENTS, ROUTINE_INTENTS, COMPLEX_INTENTS,
  SENTIMENTS, CUSTOMER_TIERS, ONBOARDING_QUESTIONS, PLANS,
};
