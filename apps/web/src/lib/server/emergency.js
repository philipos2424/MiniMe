/**
 * Emergency detection + safe holding-reply generation.
 *
 * Why this exists: in secretary mode the bot replies AS the owner. When a contact
 * sends a crisis message ("I got into a car accident, come now"), the normal reply
 * paths happily generated "I'm on my way" — a false promise of physical rescue
 * that the AI can't keep and that can stop the person from getting real help, while
 * the real owner was never told. This module detects genuine emergencies and builds
 * a SAFE reply: caring, promises NOTHING, hands over real contacts (the owner's
 * phone + emergency-service numbers). The orchestration (send + owner alert) lives
 * in replyEngine's handleEmergency(), which has the DB helpers.
 *
 * Pure + self-contained so it can be unit-tested without the DB/Telegram layer.
 */
import { makeOpenAI } from './openaiClient';
import { MODEL_MINI } from './constants';

const openai = makeOpenAI();

// ── Stage 1: free, bilingual (EN/Amharic) keyword pre-filter ─────────────────
// Catches anything that COULD be an emergency. False positives ("this traffic is
// killing me", "emergency sale") are filtered by the Stage-2 LLM confirm below.
// No match here → we never spend a model call. ≈all normal traffic exits here.
export const EMERGENCY_RE = new RegExp(
  [
    // English — accidents / injury / medical
    'accident', 'car crash', 'crash(ed)?', 'wreck(ed)?', 'hit by (a )?(car|truck)',
    'hurt( bad| badly)?', 'injur(ed|y)', 'bleeding', 'blood everywhere',
    'hospital', 'ambulance', 'emergency', 'overdose', 'unconscious', 'passed out',
    'collaps(e|ed|ing)', 'can.?t breathe', 'choking', 'drowning', 'heart attack',
    'seizure', 'dying', 'i.?m gonna die', 'about to die',
    // English — violence / danger
    'attacked', 'mugged', 'robbed', 'stabbed', 'shot', 'kidnapp',
    'on fire', 'burning', 'house fire',
    // English — urgent plea
    'help me', 'i need help', 'need you (right )?now', 'come (right )?now',
    'save me', 'call (the )?(police|ambulance|911|999)', 'in danger',
    'deep trouble', 'big trouble', 'serious trouble',
    // Amharic
    'አደጋ', 'ድንገተኛ', 'ሆስፒታል', 'አምቡላንስ', 'እርዱኝ', 'እርዳኝ', 'ተመታሁ',
    'ደም', 'እሳት', 'ፖሊስ', 'እሞታለሁ', 'ሞት', 'ቶሎ ና', 'አግዙኝ', 'አደገኛ',
  ].join('|'),
  'i',
);

// ── Safety guard: phrases that promise physical presence / arrival / a plan ──
// If a generated holding reply trips this, we DISCARD it and fall back to the
// vetted template. This is the last line of defence against "I'm on my way".
export const PROMISE_GUARD_RE = new RegExp(
  [
    'on (my|the) way', '\\bomw\\b', "i.?m coming", 'i am coming', "i.?ll come",
    'i will come', "i.?ll be (right )?there", 'i will be there', 'be right there',
    'be there (in|soon|shortly)', 'on it.{0,5}com', 'heading (over|there|out)',
    "i.?m (almost|nearly) there", 'almost there', 'leaving (now|right now)',
    "i.?ll pick you up", 'pick you up', "i.?ll get there", 'see you (soon|in)',
    'hang tight', 'stay (put|calm).{0,12}(i.?ll|i will)',
    'in \\d+ ?(min|mins|minutes|hour|hours)', '\\d+ ?(min|mins|minutes) away',
    // Amharic — "I'll come / I'm coming"
    'እመጣለሁ', 'መጣሁ', 'እየመጣሁ', 'ቶሎ እመጣለሁ',
  ].join('|'),
  'i',
);

export function looksLikeEmergency(text) {
  return !!text && EMERGENCY_RE.test(text);
}

/**
 * Two-stage detection. Returns { isEmergency, severity?, reason? }.
 * Fails SAFE: if the confirm call errors, we treat a keyword hit as an emergency
 * (over-escalating is far cheaper than missing a real crisis).
 */
export async function detectEmergency(text) {
  if (!looksLikeEmergency(text)) return { isEmergency: false };

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL_MINI,
      response_format: { type: 'json_object' },
      max_tokens: 80,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a safety classifier. A message tripped an emergency keyword filter.
Decide if it describes a REAL, urgent emergency happening to the sender or someone close to them — an accident, injury, medical crisis, violence, fire, being in immediate danger, or a genuine urgent plea for help — RIGHT NOW.
It is NOT an emergency if it's a figure of speech, joke, exaggeration ("this traffic is killing me", "dying of laughter"), marketing ("emergency sale"), or clearly in the past/hypothetical.
Return ONLY JSON: {"is_emergency": boolean, "severity": "low"|"high"|"critical", "reason": "<=8 words"}`,
        },
        { role: 'user', content: String(text).slice(0, 600) },
      ],
    });
    const j = JSON.parse(resp.choices[0].message.content);
    return { isEmergency: !!j.is_emergency, severity: j.severity || 'high', reason: j.reason };
  } catch (e) {
    console.warn('[emergency] confirm failed — failing safe (treat as emergency):', e.message);
    return { isEmergency: true, severity: 'unknown', reason: 'detector_error_failsafe' };
  }
}

/** True when the text does NOT promise physical presence / a plan. */
export function passesSafetyGuard(text) {
  return !!text && !PROMISE_GUARD_RE.test(text);
}

// Sensible Ethiopian defaults; overridable per business via
// notification_prefs.emergency_numbers (array of "number" strings or
// { label, number } objects).
const DEFAULT_EMERGENCY_NUMBERS = [
  { label: 'Ambulance', number: '907' },
  { label: 'Police', number: '991' },
  { label: 'Fire', number: '939' },
];

export function emergencyNumbers(business) {
  const custom = business?.notification_prefs?.emergency_numbers;
  if (Array.isArray(custom) && custom.length) {
    return custom
      .map(n => (typeof n === 'string' ? { label: '', number: n } : n))
      .filter(n => n && n.number);
  }
  return DEFAULT_EMERGENCY_NUMBERS;
}

/** Deterministic contact block — never trust the LLM with the actual numbers. */
export function buildContactBlock(business) {
  const lines = [];
  if (business?.owner_phone) lines.push(`📞 Call me directly: ${business.owner_phone}`);
  const nums = emergencyNumbers(business)
    .map(n => (n.label ? `${n.label} ${n.number}` : n.number))
    .join(' · ');
  if (nums) lines.push(`🚨 Emergency services: ${nums}`);
  return lines.join('\n');
}

/** Vetted, promise-free fallback (bilingual) used when the LLM trips the guard. */
export function emergencyTemplate(business, firstName) {
  const hi = firstName ? `${firstName}, ` : '';
  return `${hi}I just saw this — are you okay? If anyone is hurt, please call an ambulance right now. I'm getting help to you.
ደህና ነህ? ጉዳት ካለ ቶሎ አምቡላንስ ጥራ። እርዳታ እያገኘሁልህ ነው።`;
}

/**
 * Build the safe holding reply: LLM in the owner's voice under strict rules,
 * guarded against promise/physical phrasing (template fallback), with the real
 * contact block appended deterministically.
 */
export async function generateHoldingReply({ business, contactProfile, history = [], text }) {
  const firstName = (contactProfile?.name || '').split(/\s+/)[0] || '';
  const ownerFull = business?.owner_name || 'the owner';

  let reply = null;
  try {
    const resp = await openai.chat.completions.create({
      model: MODEL_MINI,
      max_tokens: 160,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: `You are ${ownerFull}, replying on your personal Telegram to someone who just told you about an EMERGENCY (accident, injury, danger, urgent crisis). This is real and serious.

Text like a caring real person in a crisis — short, warm, urgent. Match their language (English / Amharic / mixed).

ABSOLUTE RULES — breaking these is dangerous:
- PROMISE NOTHING. Do NOT say you're coming, on your way, will be there, will pick them up, "see you soon", or give any time ("5 min", "soon"). You physically cannot, and a false promise can stop them getting real help.
- Do NOT commit to any plan, action, or arrival.
- DO ask if they're safe / how badly hurt, and tell them to call emergency services or an ambulance RIGHT NOW if anyone is hurt.
- Tell them you're getting help / a real person to them right now.
- 1-3 short lines. No business talk. Don't mention being an AI.

Write ONLY the message text.`,
        },
        ...history.map(m => ({
          role: m.direction === 'inbound' ? 'user' : 'assistant',
          content: (m.content || '').slice(0, 300),
        })),
        { role: 'user', content: String(text).slice(0, 600) },
      ],
    });
    reply = resp.choices?.[0]?.message?.content?.trim();
  } catch (e) {
    console.warn('[emergency] holding-reply generation failed:', e.message);
  }

  if (!passesSafetyGuard(reply)) {
    if (reply) console.warn('[emergency] holding reply tripped safety guard — using template');
    reply = emergencyTemplate(business, firstName);
  }

  const contacts = buildContactBlock(business);
  return contacts ? `${reply}\n\n${contacts}` : reply;
}
