/**
 * Bot profile text (setMyName / setMyDescription / setMyShortDescription) for
 * the bots minime registers with Telegram. Kept separate from botCopy.js
 * (which is in-chat messages) since profile text has different length limits
 * (name ≤64, description ≤512, short description ≤120) and is set once per
 * bot/link rather than sent as a message.
 */

// Per-tenant custom bot (apps/api/bot/link) — shown on the bot's own profile
// page and in the "What can this bot do?" empty-chat box.
export const TENANT_BOT_PROFILE = {
  default: {
    short_description: 'Your AI shop assistant — answers customers, tracks orders, and watches your stock.',
    description:
      "I'm your business's AI assistant, powered by MiniMe. I answer your customers instantly in your voice, " +
      'follow up when they go quiet, track orders and inventory, and warn you before you run out of stock. ' +
      "Type /help to see everything I can do.",
  },
  am: {
    short_description: 'የእርስዎ AI የንግድ ረዳት — ደንበኞችን ይመልሳል፣ ትዕዛዞችን ይከታተላል፣ ክምችትንም ይጠብቃል።',
    description:
      'እኔ በ MiniMe የተጎላበተ የእርስዎ የንግድ AI ረዳት ነኝ። ደንበኞችዎን በእርስዎ ድምጽ ወዲያውኑ እመልሳለሁ፣ ዝም ሲሉ ተከታትዬ አስታውሳለሁ፣ ' +
      'ትዕዛዞችን እና ክምችትን እከታተላለሁ፣ ከማለቁም በፊት አስጠነቅቃለሁ። ሙሉ ትዕዛዞችን ለማየት /help ይተይቡ።',
  },
};

// Shared platform bot (@MiniMeAgentBot) — the owner's personal assistant /
// onboarding front door, not customer-facing.
export const AGENT_BOT_PROFILE = {
  default: {
    short_description: 'MiniMe — your AI business assistant for Telegram.',
    description:
      'I help small business owners run their shop on Telegram: I can reply to customers for you, track orders ' +
      'and inventory, remind you about follow-ups, and connect your own bot or Telegram Business account. ' +
      'Type /start to set up your business.',
  },
  am: {
    short_description: 'ሚኒሚ — በቴሌግራም ላይ ያለ የእርስዎ AI የንግድ ረዳት።',
    description:
      'የንግድ ባለቤቶች በቴሌግራም ላይ ሱቃቸውን እንዲያስተዳድሩ እረዳለሁ፦ ለደንበኞች ምላሽ መስጠት፣ ትዕዛዞችንና ክምችትን መከታተል፣ ክትትሎችን ማስታወስ፣ ' +
      'እና የራስዎን ቦት ወይም የቴሌግራም ቢዝነስ አካውንት ማገናኘት እችላለሁ። ንግድዎን ለማዘጋጀት /start ይተይቡ።',
  },
};

// MiniMe Search — cross-business buyer-facing discovery bot.
export const SEARCH_BOT_PROFILE = {
  default: {
    short_description: 'Search products from every business on MiniMe, right inside Telegram.',
    description:
      'Type what you\'re looking for and I\'ll search products from every business on MiniMe. You can also use me ' +
      'inline — type @MiniMeSearchBot in any chat to search without leaving the conversation.',
  },
  am: {
    short_description: 'በ MiniMe ላይ ካሉ ሁሉም ንግዶች ውጤቶችን በቴሌግራም ውስጥ ይፈልጉ።',
    description:
      'የሚፈልጉትን ይተይቡ፤ በ MiniMe ላይ ካሉ ሁሉም ንግዶች ውጤቶችን እፈልጋለሁ። እንዲሁም ውይይቱን ሳይለቁ ለመፈለግ በማንኛውም ቻት ውስጥ ' +
      '@MiniMeSearchBot ብለው በመተየብ ውስጣዊ (inline) አጠቃቀም ይችላሉ።',
  },
};

/**
 * Fire the description-setting calls (name is intentionally left alone —
 * BotFather-set names rarely need automation and setMyName has a narrower
 * 64-char limit that easily clashes with a business's chosen bot name) for
 * `default` plus every language in `languages` that has a translation.
 * Best-effort: callers should not await failures blocking the response.
 */
export async function applyBotProfile(tg, token, profile, languages = []) {
  const langs = ['default', ...languages.filter((l) => l !== 'default' && profile[l])];
  await Promise.all(langs.map(async (lang) => {
    const copy = profile[lang];
    if (!copy) return;
    const language_code = lang === 'default' ? undefined : lang;
    await Promise.all([
      tg(token, 'setMyDescription', { description: copy.description, language_code }),
      tg(token, 'setMyShortDescription', { short_description: copy.short_description, language_code }),
    ]);
  }));
}
