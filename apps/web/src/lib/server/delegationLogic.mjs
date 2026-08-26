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

// Same signal set as replyEngine.js's SUPPLIER_SIGNAL_RE — a message that reads
// as a price/order/stock ask, not a check-in with the agent.
const CUSTOMER_SIGNAL_RE = /(\d+[\s.,]?\d*\s*(birr|etb|usd|\$|€|¥|br|per|each|unit|pcs|kg|ton|box|pack|carton)|\b(price|quote|offer|cost|rate|avail|stock|deliver|lead.?time|moq|minimum|fob|cif|invoice|payment.?term|out.?of.?stock|unavail)\b)/i;

/**
 * Classify a message from a team member who currently has NO open task. Pure,
 * deterministic — no LLM call, since this decides only routing (help vs.
 * mytasks vs. "let the customer flow handle it"), not conversation content.
 * Returns 'help' | 'mytasks' | 'customer_shaped' | 'greeting' | 'ignore'.
 */
export function classifyTasklessMemberText(text) {
  const t = String(text || '').trim();
  if (!t) return 'ignore';
  const lower = t.toLowerCase();
  if (lower === '/mytasks' || lower.startsWith('/mytasks ') || lower.startsWith('/mytasks@')) return 'mytasks';
  if (lower === '/help' || lower.startsWith('/help ') || lower.startsWith('/help@')) return 'help';
  // A customer-shaped signal always wins, even if it's also a greeting —
  // "hi, how much is the blue dress?" must fall through to the customer flow.
  if (CUSTOMER_SIGNAL_RE.test(t)) return 'customer_shaped';
  return 'greeting';
}


/**
 * Inline buttons for a team-group task post, derived from the task's live
 * state so a member can drive it with one tap instead of composing a reply.
 * Deliberately narrower than the DM keyboard: the real back-and-forth
 * (questions, negotiation, "can I do it tomorrow?") still belongs in the 1:1
 * thread teamBrain runs — the group only needs the three transitions everyone
 * else benefits from seeing.
 *
 * Verbs match the handlers already in replyEngine.js (dtask_accept / dtask_done
 * / dtask_blocked), so this adds no new callback surface. Returns null when
 * there's nothing left to tap, which is also the signal to clear the markup.
 *
 * An unassigned task gets no buttons: replyEngine authorises every assignee
 * verb against task.supplier_id, so rendering them on a task nobody owns just
 * shows the whole group three controls that all answer "Not your task".
 * escalateToOwner posts exactly such a task when nobody could be assigned.
 */
export function teamGroupTaskButtons(task) {
  if (!task?.id || !task.supplier_id) return null;
  if (['completed', 'cancelled', 'failed'].includes(task.status)) return null;

  const first = [];
  // Acceptance is what the chase loop waits on, so offer it until it lands.
  if (!task.accepted_at) first.push({ text: '✅ On it', callback_data: `dtask_accept_${task.id}` });
  first.push({ text: '🏁 Done', callback_data: `dtask_done_${task.id}` });

  const rows = [first];
  if (task.status !== 'blocked') {
    rows.push([{ text: '⛔ Blocked', callback_data: `dtask_blocked_${task.id}` }]);
  }
  return { inline_keyboard: rows };
}

/**
 * Sort live delegated tasks into the standup's buckets. Pure so the report
 * shape is testable without a Telegram round-trip.
 *
 * Buckets are mutually exclusive and ordered by how much they need a human:
 * blocked (someone is stuck) → overdue (the deadline passed) → silent (assigned
 * long enough ago that acceptance should have come and didn't) → in progress.
 * "Silent" is the bucket that makes this a management report rather than a
 * status list: assigned_at/accepted_at/chase_count are already on every row,
 * and nothing read them before.
 */
export function bucketStandupTasks(live, nowMs = Date.now(), acceptWaitMs = ACCEPT_WAIT_MS) {
  const blocked = [], overdue = [], silent = [], inProgress = [];
  for (const t of live || []) {
    const isOverdue = !!(t.due_at && Date.parse(t.due_at) < nowMs);
    if (t.status === 'blocked') blocked.push(t);
    else if (isOverdue) overdue.push(t);
    else if (t.status === 'in_progress' && !t.accepted_at
             && t.assigned_at && Date.parse(t.assigned_at) < nowMs - acceptWaitMs) silent.push(t);
    else if (t.status === 'in_progress') inProgress.push(t);
  }
  return { blocked, overdue, silent, inProgress };
}

/**
 * Per-member reliability, folded out of the delegation audit trail.
 *
 * agent_task_events records assigned/accepted/chased/escalated/completed per
 * task, and agent_tasks carries who owned it — but nothing joined the two, so
 * the only reliability signal anywhere was an on-time rate computed from
 * due_at alone. That misses the thing an owner actually feels: how much
 * chasing a person costs, and how long they take to say yes.
 *
 * Pure: takes the two row sets, returns a map keyed by supplier_id. Tasks with
 * no assignee are ignored — there is nobody to attribute them to.
 */
export function memberReliability(tasks, events) {
  const ownerOf = new Map();   // task_id -> supplier_id
  const stats = new Map();     // supplier_id -> row
  const at = (v) => (v ? Date.parse(v) : NaN);

  const row = (id) => {
    if (!stats.has(id)) {
      stats.set(id, {
        supplier_id: id, assigned: 0, open: 0, completed: 0, onTime: 0, withDue: 0,
        chases: 0, escalations: 0, acceptSamples: [], avgAcceptMins: null, onTimeRate: null,
      });
    }
    return stats.get(id);
  };

  for (const t of tasks || []) {
    if (!t.supplier_id) continue;
    ownerOf.set(t.id, t.supplier_id);
    const r = row(t.supplier_id);
    r.assigned += 1;
    if (['pending', 'in_progress', 'blocked'].includes(t.status)) r.open += 1;
    if (t.status === 'completed') {
      r.completed += 1;
      if (t.due_at) {
        r.withDue += 1;
        if (t.completed_at && at(t.completed_at) <= at(t.due_at)) r.onTime += 1;
      }
    }
    // Acceptance latency comes off the task itself when both stamps are
    // present — the events are a fallback for rows predating those columns.
    const lag = at(t.accepted_at) - at(t.assigned_at);
    if (Number.isFinite(lag) && lag >= 0) r.acceptSamples.push(lag);
  }

  for (const ev of events || []) {
    const owner = ownerOf.get(ev.task_id);
    if (!owner) continue;
    const r = row(owner);
    if (ev.action === 'chased') r.chases += 1;
    else if (ev.action === 'escalated') r.escalations += 1;
  }

  for (const r of stats.values()) {
    if (r.acceptSamples.length) {
      const mean = r.acceptSamples.reduce((a, b) => a + b, 0) / r.acceptSamples.length;
      r.avgAcceptMins = Math.round(mean / 60000);
    }
    if (r.withDue) r.onTimeRate = Math.round((r.onTime / r.withDue) * 100);
    delete r.acceptSamples;
  }
  return stats;
}

/**
 * The members whose live work is costing the most chasing right now, worst
 * first. Feeds the standup's one-line footer — a daily report should name who
 * needs a nudge, but only when that is actually true, so anything under
 * minChases is left out entirely.
 */
export function needsChasing(liveTasks, minChases = 2) {
  const byName = new Map();
  for (const t of liveTasks || []) {
    if (!t.supplier_name || !t.chase_count) continue;
    byName.set(t.supplier_name, (byName.get(t.supplier_name) || 0) + t.chase_count);
  }
  return [...byName.entries()]
    .filter(([, n]) => n >= minChases)
    .sort((a, b) => b[1] - a[1])
    .map(([name, chases]) => ({ name, chases }));
}
