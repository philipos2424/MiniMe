// Pure helpers for the personal-account (secretary) contact flow. Kept out of
// the webhook route so they can be unit-tested — Next route files can't export
// extras.

export const PENDING_MAX_AGE_MS = 48 * 3600 * 1000;
export const PENDING_MAX_ENTRIES = 50;

// Held threads nobody classified used to live forever and every webhook
// rewrites the whole prefs blob. Drop anything stale and keep the newest few.
export function prunePending(pending, now = Date.now()) {
  const live = Object.entries(pending || {}).filter(([, e]) => {
    const t = new Date(e?.at || e?.asked_at || 0).getTime();
    return t && now - t < PENDING_MAX_AGE_MS;
  });
  live.sort((a, b) => new Date(b[1].at || b[1].asked_at || 0) - new Date(a[1].at || a[1].asked_at || 0));
  return Object.fromEntries(live.slice(0, PENDING_MAX_ENTRIES));
}

// Per-person rule the owner set: 'auto' | 'ask' | 'never', else null.
export function contactRuleFor(prefs, tgId) {
  const r = prefs?.contact_rules?.[String(tgId)]?.rule;
  return r === 'auto' || r === 'ask' || r === 'never' ? r : null;
}

// Map a model's one-word triage answer to a relation. Anything not clearly one
// of the three is 'unsure' — which means the owner is asked.
export function parseTriage(word) {
  const w = String(word || '').toLowerCase();
  if (w.includes('unsure')) return 'unsure';
  if (w.includes('family')) return 'family';
  if (w.includes('friend')) return 'friend';
  if (w.includes('customer')) return 'customer';
  return 'unsure';
}

export const ALERT_MODES = ['all', 'first', 'off'];

// Should the owner get a "Replied as you" ping for this secretary auto-reply?
// Default ('all', personal on) is the pre-existing behaviour, so nothing changes
// until the owner opts in. Only secretary (personal-account) replies are gated;
// shop-bot auto-replies are unaffected.
//   secretary_alerts: 'all' | 'first' (first reply of a conversation) | 'off'
//   alerts_personal:  false hides pings for family/friend chats entirely
export function shouldNotifyAutoSent(prefs, { isSecretary, isPersonal, isFirstReply }) {
  if (!isSecretary) return true;
  if (isPersonal && prefs?.alerts_personal === false) return false;
  const mode = ALERT_MODES.includes(prefs?.secretary_alerts) ? prefs.secretary_alerts : 'all';
  if (mode === 'off') return false;
  if (mode === 'first') return !!isFirstReply;
  return true;
}

// What to do with a first message from someone we have no record of: answer now
// ('auto') or hold it and ask the owner ('ask'). A per-person rule beats the
// global mode in BOTH directions; 'never' is handled before this is reached.
//   triage: 'customer' | 'family' | 'friend' | 'unsure' | null (not run)
export function decideUnknownSender({ mode, rule, triage }) {
  if (rule === 'ask') return 'ask';
  if (rule === 'auto') return 'auto';
  if (mode === 'auto') return 'auto';
  if (mode === 'smart' && (triage === 'customer' || triage === 'family' || triage === 'friend')) return 'auto';
  return 'ask';
}
