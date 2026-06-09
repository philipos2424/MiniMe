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

module.exports = {
  getClassificationPrompt,
};
