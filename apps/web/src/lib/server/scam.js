/**
 * Heuristic scam shield — ported verbatim from apps/bot/src/services/scam.js.
 * Pure function, no IO, safe for Vercel Edge or Node.
 */
const RED_FLAGS = [
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
  /አሸንፈዋል/,
  /ቦነስ አግኝተዋል/,
  /ሎተሪ/,
  /ፔይ\s*ፓል/i,
  /password|passcode|pin\s*code/i,
  /የባንክ.*መለያ/,
  /ሚስጥር\s*ቁልፍ/,
];

const URGENT_PRESSURE = [
  /urgent(ly)?\s*send/i,
  /within\s*\d+\s*(min|hour)/i,
  /right\s*now.*pay/i,
  /አሁን\s*ላክ/,
  /ፈጥነው/,
];

export function scanForScam(text) {
  if (!text) return { isScam: false, score: 0, reasons: [] };
  const reasons = [];
  let score = 0;

  for (const rx of RED_FLAGS) {
    if (rx.test(text)) { score += 0.4; reasons.push(`matches "${rx.source.slice(0, 30)}"`); }
  }
  for (const rx of URGENT_PRESSURE) {
    if (rx.test(text)) { score += 0.2; reasons.push('pressure tactic'); }
  }

  const urls = text.match(/https?:\/\/\S+/gi) || [];
  for (const u of urls) {
    if (/bit\.ly|tinyurl|goo\.gl|t\.co|shrt\./i.test(u)) { score += 0.25; reasons.push(`shortened link: ${u}`); }
    if (/\.(ru|cn|tk|ml|ga|cf)\b/i.test(u)) { score += 0.2; reasons.push(`suspicious TLD: ${u}`); }
  }

  if (/send|transfer|pay/i.test(text) && /account|wallet|tele\s*birr|cbe/i.test(text) && text.length < 200) {
    score += 0.15; reasons.push('payment + account in short message');
  }

  score = Math.min(1, score);
  return { isScam: score >= 0.5, score, reasons: [...new Set(reasons)] };
}
