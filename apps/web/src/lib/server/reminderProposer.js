/**
 * Proactive reminder "brain".
 *
 * Any time a date / commitment shows up in a chat — whether the CONTACT said it
 * ("let's meet tomorrow 3pm") or the OWNER said it ("I'll call you Monday") — we
 * notice it and DM the owner a one-tap "want me to remind you?" prompt. On accept
 * (remind_ok_<id> callback in replyEngine.js) it becomes a real reminder via the
 * existing addReminder + cron/reminders pipeline.
 *
 * Cost discipline: a cheap regex gate runs first and returns at zero cost when
 * there is no date/time cue, so the vast majority of messages never hit an LLM.
 */
import { supabase } from './db';
import { makeOpenAI } from './openaiClient';
import { MODEL_MINI } from './constants';
import { tg } from './telegramApi';

const openai = makeOpenAI();
const EAT_MS = 3 * 60 * 60 * 1000; // Ethiopia is UTC+3 (no DST)
const PROBE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // ≤1 proposal per conversation / 6h

// Cheap gate: English + transliterated/script Amharic date & time cues.
const DATE_CUE_RE = new RegExp(
  [
    // weekdays
    'mon(day)?', 'tue(s|sday)?', 'wed(nesday)?', 'thu(r|rsday)?', 'fri(day)?', 'sat(urday)?', 'sun(day)?',
    // relative
    'today', 'tonight', 'tomorrow', 'tmrw', 'tmr', 'next week', 'next month', 'this (week|weekend|evening|afternoon|morning)',
    'in (a|an|\\d+)\\s*(min|minute|hour|hr|day|week|month)', 'weekend',
    // clock times
    '\\b\\d{1,2}\\s*(:|\\.)\\s*\\d{2}\\b', '\\b\\d{1,2}\\s*(am|pm)\\b', '\\bat \\d{1,2}\\b', "\\bo'clock\\b",
    // explicit dates
    '\\b\\d{1,2}[\\/\\-]\\d{1,2}\\b',
    'jan(uary)?', 'feb(ruary)?', 'mar(ch)?', 'apr(il)?', 'may', 'jun(e)?', 'jul(y)?', 'aug(ust)?', 'sep(t|tember)?', 'oct(ober)?', 'nov(ember)?', 'dec(ember)?',
    // transliterated Amharic
    'nege', 'zare', 'sanyo', 'maksanyo', 'rebue', 'hamus', 'arb', 'kidame', 'ehud', 'saat',
  ].join('|'),
  'i',
);
// Amharic script cues (separate — the Latin regex's \b doesn't help Ethiopic).
const DATE_CUE_AM = /(ነገ|ዛሬ|ሰኞ|ማክሰኞ|ረቡዕ|ሐሙስ|ዓርብ|ቅዳሜ|እሁድ|ሰዓት|ጥዋት|ከሰዓት|ማታ|ሳምንት|ወር|በኋላ)/;

function hasDateCue(text) {
  if (!text || text.length < 4) return false;
  return DATE_CUE_RE.test(text) || DATE_CUE_AM.test(text);
}

/** Treat a tz-naive ISO (YYYY-MM-DDTHH:MM[:SS]) as EAT wall-clock → real UTC Date. */
function eatIsoToUtc(iso) {
  const s = String(iso || '');
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) { const d = new Date(s); return Number.isFinite(d.getTime()) ? d : null; }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const d = new Date(s); return Number.isFinite(d.getTime()) ? d : null; }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - EAT_MS);
}

function prettyEat(date) {
  try {
    return date.toLocaleString('en-GB', {
      timeZone: 'Africa/Addis_Ababa',
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(date.getTime() + EAT_MS).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * @param {object} a
 * @param {string} a.token            bot token
 * @param {object} a.business         business row (needs id, owner_private_chat_id/owner_telegram_id, notification_prefs)
 * @param {string} a.conversationId   conversation id (for memory + per-conversation cooldown)
 * @param {string|null} a.customerId  customer id (to also persist the commitment)
 * @param {string} a.customerName     the contact's display name
 * @param {string} a.text             the message text to scan
 * @param {'inbound'|'outbound'} a.direction  who SENT the text
 */
export async function maybeProposeReminder({ token, business, conversationId, customerId, customerName, text, direction }) {
  try {
    if (!business?.id || !text) return;
    if (!hasDateCue(text)) return; // zero-cost exit for the common case

    const ownerChat = business.owner_private_chat_id || business.owner_telegram_id;
    if (!ownerChat) return;

    const sb = supabase();

    // ── Per-conversation cooldown (read before any LLM call) ──────────────────
    let convMeta = {};
    if (conversationId) {
      const { data: conv } = await sb.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
      convMeta = conv?.metadata || {};
      const last = convMeta.last_reminder_probe_at ? Date.parse(convMeta.last_reminder_probe_at) : 0;
      if (Date.now() - last < PROBE_COOLDOWN_MS) return;
    }

    // ── LLM extraction (cheap model, strict JSON) ─────────────────────────────
    const speaker = direction === 'outbound' ? 'the business owner (ME)' : (customerName || 'the other person');
    const nowEat = new Date(Date.now() + EAT_MS).toISOString().slice(0, 16);
    const res = await openai.chat.completions.create({
      model: MODEL_MINI,
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 160,
      messages: [
        {
          role: 'system',
          content: `You detect concrete time-bound commitments, appointments, or deadlines in a single chat message so an assistant can offer a reminder.

The message was written by ${speaker}. "Now" in East Africa Time (EAT, UTC+3) is ${nowEat}.

Return strict JSON: { "has_commitment": boolean, "when_iso": string|null, "what": string }
- has_commitment: true ONLY for a real future appointment/deadline/promise tied to a specific date or time (e.g. "meet tomorrow 3pm", "deliver on Friday", "I'll call you Monday", "ነገ 4 ሰዓት"). False for vague talk ("soon", "later", "sometime"), past events, or pure chit-chat.
- when_iso: the resolved date-time as EAT wall-clock "YYYY-MM-DDTHH:MM" (NO timezone suffix). If only a date is given, use 09:00. Must be in the FUTURE relative to now.
- what: a short (≤60 char) description of the commitment, no names needed.
If unsure or nothing concrete: { "has_commitment": false, "when_iso": null, "what": "" }`,
        },
        { role: 'user', content: String(text).slice(0, 600) },
      ],
    });

    let parsed;
    try { parsed = JSON.parse(res.choices[0].message.content); } catch { return; }
    if (!parsed?.has_commitment || !parsed.when_iso) return;

    const due = eatIsoToUtc(parsed.when_iso);
    if (!due || !Number.isFinite(due.getTime())) return;
    const ms = due.getTime() - Date.now();
    if (ms < 60 * 1000) return;                 // already passed / too soon to be meaningful
    if (ms > 120 * 24 * 60 * 60 * 1000) return; // >120 days out — likely a misparse

    const what = String(parsed.what || 'this').slice(0, 60).trim();
    const reminderText = direction === 'outbound'
      ? `${what}${customerName ? ` (you told ${customerName})` : ''}`
      : `${customerName || 'They'}: ${what}`;

    // ── Dedupe against existing reminders + pending proposals (±30 min) ────────
    const { data: bizRow } = await sb.from('businesses').select('notification_prefs').eq('id', business.id).maybeSingle();
    const prefs = bizRow?.notification_prefs || {};
    const reminders = Array.isArray(prefs.reminders) ? prefs.reminders : [];
    const pending = prefs.pending_reminders && typeof prefs.pending_reminders === 'object' ? prefs.pending_reminders : {};
    const near = (iso) => Math.abs(new Date(iso).getTime() - due.getTime()) < 30 * 60 * 1000;
    const sameText = (t) => String(t || '').trim().toLowerCase() === reminderText.trim().toLowerCase();
    const dupe = reminders.some(r => near(r.due_at) && sameText(r.text))
      || Object.values(pending).some(p => near(p.due_at_utc) && sameText(p.text));
    if (dupe) {
      if (conversationId) await touchProbe(sb, conversationId, convMeta);
      return;
    }

    // ── Store the candidate + DM the owner with one-tap buttons ───────────────
    const id = Math.random().toString(36).slice(2, 10);
    const candidate = {
      id, due_at_utc: due.toISOString(), text: reminderText,
      who: customerName || null, conversation_id: conversationId || null,
      created_at: new Date().toISOString(),
    };
    // Keep the pending map small (latest 30 by created_at).
    const nextPending = { ...pending, [id]: candidate };
    const entries = Object.values(nextPending).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 30);
    const trimmed = {}; for (const e of entries) trimmed[e.id] = e;
    await sb.from('businesses')
      .update({ notification_prefs: { ...prefs, pending_reminders: trimmed } })
      .eq('id', business.id);

    const headline = direction === 'outbound'
      ? `📅 You mentioned: *${what}*`
      : `📅 ${customerName || 'A contact'} mentioned: *${what}*`;
    await tg(token, 'sendMessage', {
      chat_id: ownerChat,
      text: `${headline}\n🕑 ${prettyEat(due)}\n\nWant me to remind you?`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Remind me', callback_data: `remind_ok_${id}` },
          { text: '✕ No', callback_data: `remind_no_${id}` },
        ]],
      },
    });

    // ── Persist the commitment so it surfaces in future replies ───────────────
    if (customerId) {
      await sb.from('customer_memory').insert({
        customer_id: customerId,
        business_id: business.id,
        kind: 'commitment',
        content: `${what} — ${prettyEat(due)}`.slice(0, 200),
        source: 'auto_extracted',
      }).then(() => {}, () => {});
    }

    if (conversationId) await touchProbe(sb, conversationId, convMeta);
  } catch (e) {
    console.warn('[reminderProposer]', e?.message || e); // best-effort, never block a reply
  }
}

async function touchProbe(sb, conversationId, convMeta) {
  await sb.from('conversations')
    .update({ metadata: { ...convMeta, last_reminder_probe_at: new Date().toISOString() } })
    .eq('id', conversationId)
    .then(() => {}, () => {});
}
