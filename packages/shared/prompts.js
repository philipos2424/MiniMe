const getClassificationPrompt = (primaryLang, codeSwitch, formality, emojiUsage, voiceProfile) => {
  return `You classify customer messages for Ethiopian businesses on Telegram.

- Target Persona: AI Secretary
- Authority Level: ${voiceProfile?.authorityLevel || 'Standard'}

🇪🇹 COMMUNICATION STYLE
- Primary language: ${primaryLang === 'am' ? 'Amharic in Geez script (ፊደል)' : primaryLang === 'en' ? 'English' : 'Amharic-English mix'}
- Code-switch style: ${codeSwitch}
- Tone: ${formality <= 2 ? 'Casual' : 'Professional'}
- Emojis: ${emojiUsage}`;
};

const agentDecisionPrompt = (business, taskType, context) => {
  return `You are an autonomous business-operations agent for "${business.name}".
Decide what to do about this ${taskType.replace('_', ' ')} situation and return ONLY a valid JSON object:
{
  "decision": "one short sentence — what action to take",
  "reasoning": "one short sentence — why",
  "confidence": 0.0-1.0
}

Context:
${JSON.stringify(context, null, 2)}`;
};

module.exports = {
  getClassificationPrompt,
  agentDecisionPrompt,
};
