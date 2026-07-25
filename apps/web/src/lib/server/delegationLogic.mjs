/**
 * Pure decision logic for the delegation loop — no I/O, no heavy imports, so it
 * can be unit-tested in isolation (mirrors persuasion.mjs / searchRanker.mjs).
 * delegation.js imports these; the cron and reply engine only ever touch
 * delegation.js.
 */

const HOUR_MS = 3600000;
const EAT_MS = 3 * HOUR_MS;

// Bounds for the chase machine.
export const MAX_ACCEPT_PINGS = 2;    // times we re-ask "are you on it?"
export const MAX_OVERDUE_CHASES = 3;  // times we chase after the deadline
export const ACCEPT_WAIT_MS = 2 * HOUR_MS;   // grace before nudging for acceptance
export const PREDUE_WINDOW_MS = 2 * HOUR_MS; // remind this long before due_at
export const OVERDUE_CHASE_MS = HOUR_MS;     // gap between overdue chases

// File forwarding (forwardTaskFiles in delegation.js).
export const FILE_SEND_METHOD = { photo: 'sendPhoto', document: 'sendDocument', voice: 'sendVoice', video: 'sendVideo' };
export const FILE_PAYLOAD_KEY = { photo: 'photo', document: 'document', voice: 'voice', video: 'video' };

/**
 * Strips the machine-generated tag prefixes replyEngine writes into
 * messages.content for non-text media (e.g. "[photo analysis]\n...") so a
 * forwarded caption reads like what the client actually typed.
 */
export function stripMediaTags(text) {
  if (!text) return null;
  return String(text)
    .replace(/^\[voice message transcription\]\s*/i, '')
    .replace(/\[English translation\]\s*/i, '(Translation: ')
    .replace(/^\[photo analysis\]\s*\n?/i, '')
    .replace(/^\[document\]\s*\n?/i, '')
    .replace(/\n\nCustomer caption:\s*/i, ' — ')
    .trim() || null;
}

/** Parse "09:00-18:00" → { start: 9, end: 18 } (EAT wall-clock hours). Null if absent/invalid. */
export function parseActiveHours(str) {
  const m = String(str || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[3], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) return null;
  return { start, end };
}

/**
 * Given a supplier's active_hours (EAT), return the UTC ms at which it's next OK
 * to DM them. Inside the window (or none set) → fromMs unchanged.
 */
export function nextOpenTimeMs(activeHours, fromMs = Date.now()) {
  const win = parseActiveHours(activeHours);
  if (!win) return fromMs;
  const eat = new Date(fromMs + EAT_MS);
  const hour = eat.getUTCHours();
  if (hour >= win.start && hour < win.end) return fromMs;
  const cand = new Date(eat);
  cand.setUTCMinutes(0, 0, 0);
  if (hour < win.start) {
    cand.setUTCHours(win.start);
  } else {
    cand.setUTCDate(cand.getUTCDate() + 1);
    cand.setUTCHours(win.start);
  }
  return cand.getTime() - EAT_MS; // EAT wall-clock → real UTC
}

/**
 * Pure state-machine decision: given a task and the current time, return the ONE
 * action this pass should take. Assumes the caller already handled the
 * working-hours defer and the missing-assignee case.
 *   'skip' | 'blocked_escalate' | 'blocked_waiting' | 'accept_ping' |
 *   'escalate_no_accept' | 'predue_reminder' | 'overdue_chase' |
 *   'escalate_overdue' | 'overdue_waiting' | 'sleep'
 */
export function decideDelegationAction(task, nowMs = Date.now()) {
  const p = task.payload || {};

  if (task.status === 'blocked') {
    return { action: task.escalated_at ? 'blocked_waiting' : 'blocked_escalate' };
  }
  if (task.status !== 'in_progress') return { action: 'skip' };

  const dueMs = task.due_at ? Date.parse(task.due_at) : null;

  if (!task.accepted_at) {
    const pings = p.accept_pings || 0;
    return { action: pings < MAX_ACCEPT_PINGS ? 'accept_ping' : 'escalate_no_accept' };
  }
  if (dueMs && !p.predue_sent && dueMs - nowMs <= PREDUE_WINDOW_MS && dueMs - nowMs > 0) {
    return { action: 'predue_reminder' };
  }
  if (dueMs && nowMs >= dueMs) {
    const chases = task.chase_count || 0;
    if (chases < MAX_OVERDUE_CHASES) return { action: 'overdue_chase' };
    return { action: task.escalated_at ? 'overdue_waiting' : 'escalate_overdue' };
  }
  return { action: 'sleep' };
}

/**
 * Given a member's open tasks and the message id their reply answers, return the
 * task whose brief/ping that reply is about — matched on assignee_message_id.
 * Returns null when there's no reply context or no match, so the caller can fall
 * back to most-recent. Pure — exported for unit tests.
 */
export function pickTaskByReply(tasks, replyToMessageId) {
  if (!replyToMessageId || !Array.isArray(tasks)) return null;
  const target = Number(replyToMessageId);
  return tasks.find(t => Number(t.assignee_message_id) === target) || null;
}

/**
 * Pure ranking used by pickAssignee: prefer members under their cap, then the
 * least-loaded. `scored` = [{ s, load, cap }]. Returns the winning entry or null.
 */
export function pickBestCandidate(scored) {
  if (!scored?.length) return null;
  const underCap = scored.filter(x => x.load < x.cap);
  const usable = underCap.length ? underCap : scored;
  return [...usable].sort((a, b) => a.load - b.load)[0] || null;
}
