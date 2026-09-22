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

// ────────────────────────────── Member profile (chase policy) ──────────────────────────────
// The delegation loop used to treat every assignee identically: the same two
// accept-pings, the same three overdue chases, the same hour between them.
// memberReliability (below) already folds the audit trail into per-person
// signals, but nothing outside the dashboard ever read them. memberProfile is
// the one place those signals become a POLICY the loop can act on.
//
// The defaults are today's constants, so a member with no history is chased
// exactly as they are now — this is inert until the data earns it.

export const MIN_PROFILE_SAMPLES = 4;   // completed tasks before a tier can move off 'steady'
export const ACCEPT_WAIT_MIN_MS = 30 * 60000;
export const ACCEPT_WAIT_MAX_MS = 4 * HOUR_MS;

export const DEFAULT_POLICY = Object.freeze({
  tier: 'steady',
  score: null,
  acceptWaitMs: ACCEPT_WAIT_MS,
  maxAcceptPings: MAX_ACCEPT_PINGS,
  maxOverdueChases: MAX_OVERDUE_CHASES,
  overdueChaseMs: OVERDUE_CHASE_MS,
});

// Proven members get more rope and fewer interruptions; shaky members get the
// owner involved fast rather than being nagged. 'steady' is today, exactly.
const TIER_BUDGETS = {
  proven: { maxAcceptPings: 3, maxOverdueChases: 3, overdueChaseMs: 90 * 60000 },
  steady: { maxAcceptPings: MAX_ACCEPT_PINGS, maxOverdueChases: MAX_OVERDUE_CHASES, overdueChaseMs: OVERDUE_CHASE_MS },
  shaky: { maxAcceptPings: 1, maxOverdueChases: 1, overdueChaseMs: 45 * 60000 },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * 0..1 reliability from one memberReliability row. Weighted by what each
 * failure actually costs the owner: delivering on time is the outcome, but how
 * much CHASING it took is what they feel day to day — and what this agent
 * spends messages on. Escalation is the rarest and loudest signal, so it takes
 * the smallest weight with the steepest slope.
 */
export function reliabilityScore(r) {
  if (!r) return null;
  const assigned = Math.max(1, r.assigned || 0);
  const onTimeNorm = r.withDue ? r.onTime / r.withDue : 0.6; // no deadlines yet = neutral
  const chaseNorm = 1 - Math.min(1, (r.chases || 0) / assigned);
  const escNorm = 1 - Math.min(1, ((r.escalations || 0) / assigned) * 2);
  return 0.45 * onTimeNorm + 0.35 * chaseNorm + 0.20 * escNorm;
}

/**
 * Turn a memberReliability row into the chase policy for that person.
 *
 * Two independent halves:
 *  - acceptWaitMs comes from THEIR OWN acceptance latency, no tier involved.
 *    A member who always answers in 5 minutes shouldn't get two hours of
 *    silence when something is already wrong; one who normally takes 90
 *    shouldn't be pinged for behaving normally.
 *  - the ping/chase BUDGET comes from the tier, which needs enough completed
 *    tasks to mean anything. Below MIN_PROFILE_SAMPLES everyone is 'steady'.
 */
export function memberProfile(r) {
  if (!r) return { ...DEFAULT_POLICY };

  const score = reliabilityScore(r);
  const samples = r.completed || 0;

  let tier = 'steady';
  if (samples >= MIN_PROFILE_SAMPLES && Number.isFinite(score)) {
    if (score >= 0.75) tier = 'proven';
    else if (score <= 0.40) tier = 'shaky';
  }

  const acceptWaitMs = Number.isFinite(r.avgAcceptMins)
    ? clamp(r.avgAcceptMins * 60000 * 1.5, ACCEPT_WAIT_MIN_MS, ACCEPT_WAIT_MAX_MS)
    : ACCEPT_WAIT_MS;

  // avgAcceptMins rides along so escalation copy can say what's NORMAL for this
  // person ("they usually answer within 20 minutes") rather than just what
  // happened. Null when there's no history to speak from.
  const avgAcceptMins = Number.isFinite(r.avgAcceptMins) ? r.avgAcceptMins : null;

  return { tier, score, acceptWaitMs, avgAcceptMins, ...TIER_BUDGETS[tier] };
}

/**
 * Pure state-machine decision: given a task and the current time, return the ONE
 * action this pass should take. Assumes the caller already handled the
 * working-hours defer and the missing-assignee case.
 *   'skip' | 'blocked_escalate' | 'blocked_waiting' | 'accept_ping' |
 *   'escalate_no_accept' | 'escalate_client_risk' | 'predue_reminder' |
 *   'overdue_chase' | 'escalate_overdue' | 'overdue_waiting' | 'sleep'
 *
 * `policy` is a memberProfile(); omitted, it is today's flat constants, which
 * is why every pre-existing caller and test keeps its exact behaviour.
 */
export function decideDelegationAction(task, nowMs = Date.now(), policy = DEFAULT_POLICY) {
  const p = task.payload || {};
  const pol = { ...DEFAULT_POLICY, ...(policy || {}) };

  if (task.status === 'blocked') {
    return { action: task.escalated_at ? 'blocked_waiting' : 'blocked_escalate' };
  }
  if (task.status !== 'in_progress') return { action: 'skip' };

  const dueMs = task.due_at ? Date.parse(task.due_at) : null;

  if (!task.accepted_at) {
    // A client is waiting and nobody has even confirmed they're on it. Pull the
    // owner in NOW, whatever budget is left — a client waiting is worse than an
    // owner interrupted. Only once: escalated_at falls through to the ladder.
    if (task.customer_id && dueMs && !task.escalated_at
        && dueMs - nowMs <= PREDUE_WINDOW_MS) {
      return { action: 'escalate_client_risk' };
    }
    const pings = p.accept_pings || 0;
    return { action: pings < pol.maxAcceptPings ? 'accept_ping' : 'escalate_no_accept' };
  }
  if (dueMs && !p.predue_sent && dueMs - nowMs <= PREDUE_WINDOW_MS && dueMs - nowMs > 0) {
    return { action: 'predue_reminder' };
  }
  if (dueMs && nowMs >= dueMs) {
    // Urgent work with someone whose history says it will need chasing: skip
    // the ladder entirely and hand it to the owner at the first missed deadline.
    if (pol.tier === 'shaky' && task.urgency === 'high' && !task.escalated_at) {
      return { action: 'escalate_overdue' };
    }
    const chases = task.chase_count || 0;
    if (chases < pol.maxOverdueChases) return { action: 'overdue_chase' };
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
 * Which step of a plan to act on next, given the whole ordered step list.
 *
 * Pure so the plan's advance rules are testable without a job, a supplier or a
 * Telegram round-trip — the same reason the chase machine lives here. Steps are
 * expected in order_index order.
 *
 *   'in_flight'     — a step already has a live delegated task and its own
 *                     chase schedule. Touching it would brief the same person
 *                     twice for the same work, so the plan waits.
 *   'await_client'  — the next step needs the client, not the team.
 *   'auto_complete' — a passive agent step; the caller marks it done and asks
 *                     again, which is why this returns one step at a time.
 *   'delegate'      — hand this step to a person.
 *   'job_complete'  — nothing left.
 */
export function nextPlanAction(steps) {
  for (const s of steps || []) {
    if (['done', 'skipped'].includes(s.status)) continue;
    if (s.status === 'waiting') return { action: 'in_flight', step: s };
    if (s.role === 'client') return { action: 'await_client', step: s };
    if (s.role === 'agent' && s.auto) return { action: 'auto_complete', step: s };
    return { action: 'delegate', step: s };
  }
  return { action: 'job_complete', step: null };
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
