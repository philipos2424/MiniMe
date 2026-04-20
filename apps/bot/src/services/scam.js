const RED_FLAGS = [
  // Classic scam patterns (English)
  /western\s*union/i,
  /money\s*gram/i,
  /bitcoin|btc\b|usdt|crypto wallet/i,
  /gift\s*card/i,
  /nigerian?\s*prince/i,
  /verification\s*code/i,
  /otp|one.?time.?password/i,
  /send.*code/i,
  /click.*link.*claim/i,
  /won.*lottery|you.*winner/i,
  /inherit/i,
  /investment opportunity/i,
  // Ethiopia-specific
  /አሸንፈዋል/,            // "you won"
  /ቦነስ አግኝተዋል/,         // "bonus received"
  /ሎተሪ/,                // lottery
  /ፔይ\s*ፓል/i,          // paypal mentions (uncommon in ET)
  // Credential theft
  /password|passcode|pin\s*code/i,
  /የባንክ.*መለያ/,          // bank account
  /ሚስጥር\s*ቁልፍ/,         // secret key
];

const URGENT_PRESSURE = [
  /urgent(ly)?\s*send/i,
  /within\s*\d+\s*(min|hour)/i,
  /right\s*now.*pay/i,
  /አሁን\s*ላክ/,          // "send now"
  /ፈጥነው/,              // "hurry"
];

/**
 * Heuristic scam check. Returns { isScam, score (0-1), reasons[] }.
 */
function scanForScam(text) {
  if (!text) return { isScam: false, score: 0, reasons: [] };
  const reasons = [];
  let score = 0;

  for (const rx of RED_FLAGS) {
    if (rx.test(text)) { score += 0.4; reasons.push(`matches "${rx.source.slice(0, 30)}"`); }
  }
  for (const rx of URGENT_PRESSURE) {
    if (rx.test(text)) { score += 0.2; reasons.push(`pressure tactic`); }
  }

  // Suspicious link patterns
  const urls = text.match(/https?:\/\/\S+/gi) || [];
  for (const u of urls) {
    if (/bit\.ly|tinyurl|goo\.gl|t\.co|shrt\./i.test(u)) { score += 0.25; reasons.push(`shortened link: ${u}`); }
    if (/\.(ru|cn|tk|ml|ga|cf)\b/i.test(u)) { score += 0.2; reasons.push(`suspicious TLD: ${u}`); }
  }

  // Telegram account asking for money + account info in one short message
  if (/send|transfer|pay/i.test(text) && /account|wallet|tele\s*birr|cbe/i.test(text) && text.length < 200) {
    score += 0.15; reasons.push('payment + account in short message');
  }

  score = Math.min(1, score);
  return { isScam: score >= 0.5, score, reasons: [...new Set(reasons)] };
}

module.exports = { scanForScam };
