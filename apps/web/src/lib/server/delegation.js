/**
 * Delegation loop — the "chief of staff" hands work to a team member and chases
 * it until done, as an actual conversation (teamBrain.js) rather than a
 * templated card with buttons. Real assistants text like people; so does this.
 *
 * Lifecycle (see migrations 029_delegation.sql, 031_closed_loop.sql):
 *   create → agent_tasks row (type 'delegated_task', status 'pending')
 *   proposeAssignment()  — trust-gated:
 *       trust < TRUSTED  → DM the owner a picker (who should do this?)
 *       trust >= TRUSTED → auto-pick the best team member and assign immediately
 *   assignTask()         — teamBrain sends the opening message ("can you take
 *       this on?"), status → 'in_progress'
 *   inbound from the member (text, voice, photo, document) → teamBrain reads
 *       whatever they send — a bare photo of finished work counts as done,
 *       "👍" counts as accepted, no buttons anywhere on this side
 *   /api/cron/delegation — hourly state machine:
 *       not accepted → re-ping (via teamBrain, worded fresh each time), then
 *           escalate to owner
 *       due soon     → pre-due check-in
 *       overdue      → chase (bounded), then escalate to owner
 *       blocked      → escalate to owner with the reason
 *   member says/shows they're done → completeTask() → owner + customer notified
 *
 * Timing runs on an HOURLY grid — production has no sub-hourly scheduler
 * (apps/bot's node-cron is dormant). scheduled_at means "when the cron should
 * next act"; due_at is the human commitment and never moves when the chase
 * cadence does.
 */
import { pickSupplier } from './jobFanout';
import { tg } from './telegramApi';
import { sendAsOwnerOrBot } from './sendAs';
import {
  MAX_ACCEPT_PINGS, MAX_OVERDUE_CHASES, ACCEPT_WAIT_MS, PREDUE_WINDOW_MS, OVERDUE_CHASE_MS,
  nextOpenTimeMs, decideDelegationAction, pickBestCandidate, pickTaskByReply,
  FILE_SEND_METHOD, FILE_PAYLOAD_KEY, stripMediaTags,
} from './delegationLogic.mjs';

const HOUR_MS = 3600000;

// Re-export the pure helpers so existing importers of './delegation' keep working.
export { MAX_ACCEPT_PINGS, MAX_OVERDUE_CHASES, nextOpenTimeMs, decideDelegationAction, pickBestCandidate };

function ownerChatId(business) {
  return business.owner_private_chat_id || business.owner_telegram_id || null;
}

// ────────────────────────────── Team group adoption ──────────────────────────────
/**
 * Handle a my_chat_member update for a GROUP/SUPERGROUP chat — sibling to
 * channelIngest.handleChannelMembership (which only handles 'channel' chats and
 * returns false for anything else, so this never collides with it). Adding the
 * bot to a group registers it as the team group (auto-adopt, easy off via the
 * confirmation DM's button); removing/kicking it clears the setting.
 * Returns true if handled (caller should stop), false otherwise.
 */
export async function handleTeamGroupMembership({ sb, token, business, update }) {
  const m = update.my_chat_member;
  if (!m || (m.chat?.type !== 'group' && m.chat?.type !== 'supergroup')) return false;

  const groupId = m.chat.id;
  const newStatus = m.new_chat_member?.status; // 'member'|'administrator'|'left'|'kicked'
  const wasAdded = ['member', 'administrator'].includes(newStatus)
    && !['member', 'administrator'].includes(m.old_chat_member?.status);
  const wasRemoved = ['left', 'kicked'].includes(newStatus);

  if (wasAdded) {
    await sb.from('businesses').update({ business_group_chat_id: groupId }).eq('id', business.id);
    await tg(token, 'sendMessage', {
      chat_id: groupId,
      text: `👋 Hi team! I'm MiniMe, ${business.owner_name || 'the owner'}'s assistant. I'll post task assignments and progress here so everyone's in sync.`,
    }).catch(() => {});
    const ownerChat = ownerChatId(business);
    if (ownerChat) {
      await tg(token, 'sendMessage', {
        chat_id: ownerChat, parse_mode: 'Markdown',
        text: `✅ I've been added to *${m.chat.title || 'a group'}* — I'll post task assignments and the daily standup there from now on.`,
        reply_markup: { inline_keyboard: [[{ text: "🚫 Don't use this group", callback_data: 'dtask_groupoff' }]] },
      }).catch(() => {});
    }
    return true;
  }

  if (wasRemoved && business.business_group_chat_id === groupId) {
    await sb.from('businesses').update({ business_group_chat_id: null }).eq('id', business.id);
    return true;
  }

  return false;
}

// ────────────────────────────── Team group posting ──────────────────────────────
/**
 * Post to the business's team group, if one is configured. No-op otherwise.
 * Deliberately does NOT pass business_connection_id — that's for the owner's
 * private customer chats; currentBizConnId is keyed by chat id so a group id
 * never matches anyway. Returns the send result or null.
 */
export async function postToTeamGroup(token, business, text, extra = {}) {
  const groupId = business.business_group_chat_id;
  if (!groupId) return null;
  try {
    return await tg(token, 'sendMessage', {
      chat_id: groupId, text, parse_mode: 'Markdown', disable_web_page_preview: true, ...extra,
    });
  } catch (e) {
    console.warn('[delegation] postToTeamGroup:', e.message);
    return null;
  }
}

// ────────────────────────────── Audit trail ──────────────────────────────
export async function recordTaskEvent(sb, task, { actor, action, note } = {}) {
  try {
    await sb.from('agent_task_events').insert({
      task_id: task.id,
      business_id: task.business_id,
      actor: actor || 'agent',
      action,
      note: note ? String(note).slice(0, 1000) : null,
    });
  } catch (e) {
    console.warn('[delegation] recordTaskEvent:', e.message);
  }
}

// ────────────────────────────── Assignee selection ──────────────────────────────
/** Open (unfinished) delegated tasks currently on a given team member. */
async function openTaskCount(sb, businessId, supplierId) {
  const { count } = await sb.from('agent_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('type', 'delegated_task')
    .eq('supplier_id', supplierId)
    .in('status', ['pending', 'in_progress', 'blocked']);
  return count || 0;
}

/**
 * Pick the best team member for a task. Prefers a specialty match, then the
 * least-loaded active member of the role (under their max_daily_tasks cap).
 * `suppliers.specialties` is a single TEXT column — match with substring, not array.
 */
export async function pickAssignee(sb, { businessId, role, specialty }) {
  // Candidate pool: everyone active with this role, or everyone active if no role.
  let q = sb.from('suppliers')
    .select('id, name, role, contact_telegram, specialties, max_daily_tasks, active_hours')
    .eq('business_id', businessId)
    .eq('is_active', true);
  if (role) q = q.eq('role', role);
  const { data: pool } = await q;
  let candidates = (pool || []).filter(s => s.contact_telegram);

  // If a role filter yielded nobody DM-able, fall back to the existing picker
  // (which may return an out-of-role best-effort match / handle no-role cases).
  if (!candidates.length) {
    const fallback = role ? await pickSupplier({ businessId, role }) : null;
    return (fallback && fallback.contact_telegram) ? fallback : null;
  }

  // Prefer specialty matches when a specialty was requested.
  if (specialty) {
    const spec = specialty.toLowerCase();
    const matched = candidates.filter(s => (s.specialties || '').toLowerCase().includes(spec));
    if (matched.length) candidates = matched;
  }

  // Rank by current open workload; drop anyone already at their cap unless
  // everyone is capped (never leave a task unassignable when a human exists).
  const scored = [];
  for (const s of candidates) {
    const load = await openTaskCount(sb, businessId, s.id);
    scored.push({ s, load, cap: s.max_daily_tasks ?? 5 });
  }
  return pickBestCandidate(scored)?.s || null;
}

// ────────────────────────────── Task creation ──────────────────────────────
/**
 * Create a delegated_task row (status 'pending'). Does NOT assign yet — caller
 * runs proposeAssignment() to route it (owner picker vs auto-assign).
 * customer_id must be a customers.id UUID (or null) — agent_tasks.customer_id is
 * an FK, unlike business_tasks.customer_id which was free text.
 */
export async function createDelegatedTask(sb, business, {
  title, description, role, specialty, due_at, customer_id, priority, created_by, source_conversation_id,
}) {
  const urgency = priority === 1 ? 'high' : priority === 3 ? 'low' : 'medium';
  const { data, error } = await sb.from('agent_tasks').insert({
    business_id: business.id,
    type: 'delegated_task',
    status: 'pending',
    title: String(title || 'Task').slice(0, 255),
    description: description ? String(description).slice(0, 2000) : null,
    urgency,
    due_at: due_at || null,
    customer_id: customer_id || null,
    source_conversation_id: source_conversation_id || null,
    created_by: created_by || 'agent',
    requires_approval: false,
    scheduled_at: new Date().toISOString(),
    payload: { role: role || null, specialty: specialty || null },
  }).select().single();
  if (error) return { ok: false, error: error.message };
  await recordTaskEvent(sb, data, { actor: created_by || 'agent', action: 'created', note: title });
  return { ok: true, task: data };
}

// ────────────────────────────── File forwarding ──────────────────────────────
/**
 * Forward the client's files for THIS job to the assignee — photos, documents,
 * voice notes, and video (jobFanout.js's forwarder drops video even though
 * replyEngine stores it, and scopes only by customer_id with no business_id or
 * thread filter, so it can leak an unrelated older chat's files; this is scoped
 * to the exact conversation that created the task).
 * Returns { count } so the opening message can mention it naturally.
 */
export async function forwardTaskFiles({ sb, token, business, task, supplier }) {
  if (!supplier?.contact_telegram) return { count: 0 };

  let q = sb.from('messages')
    .select('telegram_file_id, telegram_file_type, telegram_file_name, content')
    .not('telegram_file_id', 'is', null)
    .order('created_at', { ascending: true }) // oldest-first — preserves the client's sequence
    .limit(10);
  if (task.source_conversation_id) {
    q = q.eq('conversation_id', task.source_conversation_id);
  } else if (task.customer_id) {
    // Fallback for tasks with no linked conversation — still scope by business
    // so this can never cross into another business's thread.
    q = q.eq('business_id', business.id).eq('customer_id', task.customer_id);
  } else {
    return { count: 0 };
  }

  const { data: files } = await q;
  if (!files?.length) return { count: 0 };

  let sent = 0;
  for (const f of files) {
    const method = FILE_SEND_METHOD[f.telegram_file_type];
    if (!method) continue; // unrecognized type — skip rather than guess
    const caption = stripMediaTags(f.content) || f.telegram_file_name || undefined;
    const res = await sendAsOwnerOrBot({
      sb, business, chatId: supplier.contact_telegram, method,
      payload: { [FILE_PAYLOAD_KEY[f.telegram_file_type]]: f.telegram_file_id, caption: caption?.slice(0, 200) },
      prefer: supplier.contact_channel || 'auto',
    }).catch(e => { console.warn('[delegation] forwardTaskFiles send:', e.message); return { ok: false }; });
    if (res?.ok) sent++;
  }
  return { count: sent };
}

// ────────────────────────────── Assignment ──────────────────────────────
/**
 * Assign a task to a chosen team member: flips it to in_progress, sets
 * assigned_at/supplier_id, and has teamBrain send the opening message —
 * a real "can you take this on?" text, not a templated brief.
 */
export async function assignTask({ sb, token, business, task, supplier }) {
  if (!supplier?.contact_telegram) {
    return { ok: false, error: 'assignee_has_no_telegram' };
  }

  const now = Date.now();
  const nextChase = nextOpenTimeMs(supplier.active_hours, now + ACCEPT_WAIT_MS);
  await sb.from('agent_tasks').update({
    status: 'in_progress',
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    assigned_at: new Date(now).toISOString(),
    scheduled_at: new Date(nextChase).toISOString(),
    chase_count: 0,
    payload: { ...(task.payload || {}), accept_pings: 0, predue_sent: false },
  }).eq('id', task.id);

  await recordTaskEvent(sb, task, { actor: 'agent', action: 'assigned', note: supplier.name });

  // Forward the client's files for this job BEFORE the opening message, so
  // teamBrain can mention them naturally ("sending you the photos he sent")
  // instead of an unrelated afterthought.
  const freshTask = { ...task, supplier_id: supplier.id, supplier_name: supplier.name };
  const { count: fileCount } = await forwardTaskFiles({ sb, token, business, task: freshTask, supplier }).catch(() => ({ count: 0 }));

  // The opening message: teamBrain composes and sends it — a real "can you
  // take this on?" text in the owner's voice, not a templated card with
  // accept/decline buttons. It also stamps assignee_message_id on send, so
  // reply-pinning works from the very first message.
  const { runTeamBrain } = await import('./teamBrain');
  const brainResult = await runTeamBrain({
    token, business, supplier, task: freshTask,
    fileNote: fileCount > 0 ? `You just forwarded ${fileCount} file${fileCount > 1 ? 's' : ''} (photos/documents/voice) the client sent, right before this message — mention that naturally.` : null,
  }).catch(e => {
    console.warn('[delegation] assignTask teamBrain failed:', e.message);
    return { replied: false };
  });

  // Team-group visibility: announce the assignment where the whole team sees
  // it. The actual back-and-forth (accept, questions, negotiation) stays in
  // the 1:1 DM — this is an FYI note only, still natural, no buttons.
  const dueGroup = task.due_at
    ? ` · due ${new Date(task.due_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
    : '';
  await postToTeamGroup(token, business, `📋 New task for *${supplier.name}*: ${task.title}${dueGroup}. I'll follow up until it's done.`);

  return { ok: brainResult.replied !== false, supplier };
}

/**
 * Route a freshly created task. Trust-gated on the business's trust_level.
 *  - trust < TRUSTED (2): DM the owner a picker (who should do this?).
 *  - trust >= TRUSTED:    auto-pick and assign, then tell the owner who got it.
 * TRUST_LEVELS is imported lazily to avoid a heavy constants import in the
 * assign hot path — mirrors how the repo imports it elsewhere.
 */
export async function proposeAssignment({ sb, token, business, task }) {
  const { TRUST_LEVELS } = await import('./constants');
  const trust = Number(business.trust_level ?? TRUST_LEVELS.SUPERVISED);
  const p = task.payload || {};
  const role = p.role || null;
  const specialty = p.specialty || null;

  if (trust >= TRUST_LEVELS.TRUSTED) {
    const supplier = await pickAssignee(sb, { businessId: business.id, role, specialty });
    if (!supplier) return notifyOwnerNoAssignee({ sb, token, business, task, role });
    const r = await assignTask({ sb, token, business, task, supplier });
    if (!r.ok) return notifyOwnerNoAssignee({ sb, token, business, task, role });
    // Tell the owner who picked it up, with a reassign escape hatch.
    const chatId = ownerChatId(business);
    if (chatId) {
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        parse_mode: 'Markdown',
        text: `📋 *${task.title}* → assigned to *${supplier.name}*${role ? ` (${role})` : ''}. I'll follow up until it's done.`,
        reply_markup: { inline_keyboard: [[{ text: '🔄 Reassign', callback_data: `dtask_reassign_${task.id}` }]] },
      });
    }
    return { ok: true, mode: 'auto', supplier };
  }

  // Supervised: ask the owner who should do it.
  return askOwnerToAssign({ sb, token, business, task, role, specialty });
}

/**
 * Supervised path: DM the owner a picker of candidate team members. The candidate
 * list is stashed in payload.assign_candidates so the callback data stays short
 * (Telegram caps callback_data at 64 bytes — two UUIDs won't fit).
 */
async function askOwnerToAssign({ sb, token, business, task, role, specialty }) {
  const chatId = ownerChatId(business);
  if (!chatId) return { ok: false, error: 'no_owner_chat' };

  let q = sb.from('suppliers')
    .select('id, name, role, contact_telegram')
    .eq('business_id', business.id).eq('is_active', true);
  if (role) q = q.eq('role', role);
  const { data: pool } = await q;
  const candidates = (pool || []).filter(s => s.contact_telegram).slice(0, 4);

  const rows = candidates.map((s, i) => ([{
    text: `Assign to ${s.name}${s.role ? ` (${s.role})` : ''}`,
    callback_data: `dtask_assign_${task.id}_${i}`,
  }]));
  rows.push([{ text: "🙋 I'll do it", callback_data: `dtask_owner_takes_${task.id}` }]);
  rows.push([{ text: '❌ Cancel', callback_data: `dtask_cancel_${task.id}` }]);

  // Persist candidate ids by index so the callback can resolve them.
  await sb.from('agent_tasks').update({
    payload: { ...(task.payload || {}), assign_candidates: candidates.map(s => s.id) },
    scheduled_at: new Date(Date.now() + 24 * HOUR_MS).toISOString(), // stop auto-acting until owner picks
  }).eq('id', task.id);

  const dueLine = task.due_at
    ? `\n📅 Due: ${new Date(task.due_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : '';
  const body = candidates.length
    ? `📋 *New task*\n${task.title}${dueLine}\n\nWho should handle this?`
    : `📋 *New task*\n${task.title}${dueLine}\n\n_No team members with a Telegram ID yet — add them in Agent → Team, or take it yourself._`;

  await tg(token, 'sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: body, reply_markup: { inline_keyboard: rows } });
  return { ok: true, mode: 'supervised', candidates: candidates.length };
}

/**
 * Owner-initiated reassign: reset the task to pending and show the owner the
 * candidate picker again. Used by the [🔄 Reassign] button on assignment
 * notices and escalations, regardless of trust level.
 */
export async function promptReassign({ sb, token, business, task }) {
  await sb.from('agent_tasks').update({
    status: 'pending', supplier_id: null, supplier_name: null,
    assigned_at: null, accepted_at: null, chase_count: 0, escalated_at: null,
    payload: { ...(task.payload || {}), accept_pings: 0, predue_sent: false },
  }).eq('id', task.id);
  await recordTaskEvent(sb, task, { actor: 'owner', action: 'reassigned' });
  return askOwnerToAssign({ sb, token, business, task, role: task.payload?.role || null, specialty: task.payload?.specialty || null });
}

async function notifyOwnerNoAssignee({ sb, token, business, task, role }) {
  const chatId = ownerChatId(business);
  if (chatId) {
    await tg(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown',
      text: `⚠️ I couldn't assign *${task.title}* — no ${role ? `*${role}*` : 'team member'} with a Telegram ID on your team. Add one in Agent → Team, then reassign.`,
      reply_markup: { inline_keyboard: [[{ text: '🔄 Assign now', callback_data: `dtask_reassign_${task.id}` }]] },
    });
  }
  await sb.from('agent_tasks').update({
    status: 'blocked', blocked_reason: 'no assignable team member',
    scheduled_at: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
  }).eq('id', task.id);
  await recordTaskEvent(sb, task, { actor: 'agent', action: 'blocked', note: 'no assignee' });
  return { ok: false, error: 'no_assignee' };
}

// ────────────────────────────── Chase / escalate / complete ──────────────────────────────
async function loadAssignee(sb, task) {
  if (!task.supplier_id) return null;
  const { data } = await sb.from('suppliers')
    .select('id, name, role, contact_telegram, active_hours')
    .eq('id', task.supplier_id).maybeSingle();
  return data;
}

/**
 * Have teamBrain send a chase / check-in to the assignee — a natural message
 * with a specific purpose (accept-check, pre-due, overdue), worded fresh each
 * time rather than a repeated template. reply_to_member (inside teamBrain)
 * keeps assignee_message_id current for reply-pinning, same as any other send.
 */
async function pingAssignee({ token, business, task, supplier, directive }) {
  const { runTeamBrain } = await import('./teamBrain');
  return runTeamBrain({ token, business, supplier, task, directive }).catch(e => {
    console.warn('[delegation] pingAssignee teamBrain failed:', e.message);
    return { replied: false };
  });
}

/** DM the owner an escalation with the recovery actions. */
export async function escalateToOwner({ sb, token, business, task, reason }) {
  const chatId = ownerChatId(business);
  if (chatId) {
    const who = task.supplier_name || 'the assignee';
    await tg(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown',
      text: `🚨 *${task.title}*\n${reason}\nAssigned to: ${who}${task.due_at ? `\nDue: ${new Date(task.due_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}\n\nWhat do you want to do?`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Reassign', callback_data: `dtask_reassign_${task.id}` }, { text: '🙋 I\'ll handle it', callback_data: `dtask_owner_takes_${task.id}` }],
          [{ text: '❌ Cancel task', callback_data: `dtask_cancel_${task.id}` }],
        ],
      },
    });
  }
  await sb.from('agent_tasks').update({
    escalated_at: new Date().toISOString(),
    // Back off auto-chasing for a day; the owner's tap drives the next step.
    scheduled_at: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
  }).eq('id', task.id);
  await recordTaskEvent(sb, task, { actor: 'agent', action: 'escalated', note: reason });
  await postToTeamGroup(token, business, `🚨 *${task.title}* needs attention — ${reason}`);
  return { ok: true };
}

// ────────────────────────────── Client round-trip ──────────────────────────────
/** Find the conversation a client update should land in — the one that created the task, or the newest. */
async function resolveClientConversation(sb, businessId, task) {
  if (task.source_conversation_id) {
    const { data } = await sb.from('conversations').select('id').eq('id', task.source_conversation_id).maybeSingle();
    if (data) return data;
  }
  if (!task.customer_id) return null;
  const { data } = await sb.from('conversations').select('id')
    .eq('business_id', businessId).eq('customer_id', task.customer_id)
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

/** Actually send the drafted update, persist it, and tell the owner it went. */
export async function sendClientUpdate({ sb, token, business, task, cust, text, fileId, milestone }) {
  const res = await sendAsOwnerOrBot({ sb, business, chatId: cust.telegram_id, payload: { text }, prefer: 'auto' });
  if (!res.ok) return { ok: false, error: 'send_failed' };

  // Persist so the dashboard and the next LLM turn stay coherent — the old
  // completeTask sent a bare hardcoded line and logged nothing anywhere.
  const conv = await resolveClientConversation(sb, business.id, task);
  if (conv) {
    await sb.from('messages').insert({
      conversation_id: conv.id, business_id: business.id, customer_id: cust.id,
      direction: 'outbound', content: text, content_type: 'text', status: 'sent',
      is_ai_generated: true, telegram_chat_id: cust.telegram_id, sent_at: new Date().toISOString(),
    }).then(() => {}, () => {});
    await sb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id).then(() => {}, () => {});
  }

  if (fileId) {
    await sendAsOwnerOrBot({ sb, business, chatId: cust.telegram_id, method: 'sendPhoto', payload: { photo: fileId }, prefer: 'auto' }).catch(() => {});
  }

  if (milestone === 'completion') {
    await sb.from('agent_tasks').update({ client_briefed_at: new Date().toISOString() }).eq('id', task.id);
  }

  const ownerChat = ownerChatId(business);
  if (ownerChat) {
    await tg(token, 'sendMessage', {
      chat_id: ownerChat, parse_mode: 'Markdown',
      text: `📨 Told *${cust.name || 'the client'}*:\n_"${text.slice(0, 250)}"_`,
    }).catch(() => {});
  }
  return { ok: true };
}

/** Supervised path: hold the draft for the owner instead of sending straight to the client. */
async function queueClientBriefApproval({ sb, token, business, task, cust, text, fileId, milestone }) {
  const ownerChat = ownerChatId(business);
  if (!ownerChat) return sendClientUpdate({ sb, token, business, task, cust, text, fileId, milestone }); // no owner to ask — send rather than drop it

  await sb.from('agent_tasks').update({
    payload: { ...(task.payload || {}), pending_client_brief: { text, fileId: fileId || null, milestone: milestone || null } },
  }).eq('id', task.id);

  await tg(token, 'sendMessage', {
    chat_id: ownerChat, parse_mode: 'Markdown',
    text: `📨 *Update for ${cust.name || 'the client'}* on "${task.title}":\n\n${text}\n\n_Send it?_`,
    reply_markup: { inline_keyboard: [[
      { text: '✅ Send', callback_data: `dtask_briefsend_${task.id}` },
      { text: '❌ Skip', callback_data: `dtask_briefskip_${task.id}` },
    ]] },
  });
  return { ok: true, queued: true };
}

/**
 * Trust-gated, persisted client update — the ONE path every client-facing
 * send from the delegation loop goes through. `rawNote` is an internal fact
 * ("Yonas accepted, due Friday", a member's raw completion note) — it gets
 * rewritten in the owner's voice via draftMessage's customer_update mode,
 * which is instructed to never leak internal team status.
 *
 * SHADOW/SUPERVISED: queues the draft for the owner to approve/skip.
 * TRUSTED/FULL_AGENT: sends immediately and tells the owner it went.
 *
 * milestone: 'accepted' | 'completion' | null. 'completion' is guarded by
 * task.client_briefed_at so a photo follow-up can't double-brief.
 */
export async function notifyCustomer({ sb, token, business, task, rawNote, text: preText, fileId, milestone }) {
  if (!task.customer_id) return { ok: false, error: 'no_customer' };
  if (milestone === 'completion' && task.client_briefed_at) return { ok: false, error: 'already_briefed' };

  const { data: cust } = await sb.from('customers')
    .select('id, name, telegram_id').eq('id', task.customer_id).maybeSingle();
  if (!cust?.telegram_id) return { ok: false, error: 'no_telegram_id' };

  // Two entry points: a raw internal fact to be drafted into a client-facing
  // line (accept/completion milestones), or already-composed text to send
  // as-is (teamBrain's notify_client tool, which writes in the owner's voice
  // within its own conversation — redrafting it again would be redundant).
  let text = preText;
  if (!text) {
    const { draftMessage } = await import('./taskRunner');
    text = await draftMessage({ business, message: rawNote, mode: 'customer_update' });
  }
  if (!text) return { ok: false, error: 'empty_draft' };

  const { TRUST_LEVELS } = await import('./constants');
  const trust = Number(business.trust_level ?? TRUST_LEVELS.SUPERVISED);

  if (trust < TRUST_LEVELS.TRUSTED) {
    return queueClientBriefApproval({ sb, token, business, task, cust, text, fileId, milestone });
  }
  return sendClientUpdate({ sb, token, business, task, cust, text, fileId, milestone });
}

/**
 * Mark a task complete and fan out the good news: notify the owner, and the
 * customer if one is linked. Used by the ✅ Done callback and the photo step.
 */
export async function completeTask({ sb, token, business, task, note, fileId, actor }) {
  await sb.from('agent_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    completion_note: note ? String(note).slice(0, 1000) : null,
    completion_file_id: fileId || null,
  }).eq('id', task.id);
  await recordTaskEvent(sb, task, { actor: actor || 'assignee', action: 'completed', note });

  // Tell the owner.
  const chatId = ownerChatId(business);
  if (chatId) {
    await tg(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown',
      text: `✅ *Done:* ${task.title}${task.supplier_name ? `\nBy: ${task.supplier_name}` : ''}${note ? `\n_“${String(note).slice(0, 300)}”_` : ''}`,
    });
    if (fileId) {
      await tg(token, 'sendPhoto', { chat_id: chatId, photo: fileId, caption: `Proof of work: ${task.title}`.slice(0, 200) }).catch(() => {});
    }
  }

  // Tell the customer, if this task was for one — a real brief built from what
  // the member actually reported (note/photo), drafted in the owner's voice,
  // trust-gated, and persisted so the thread stays coherent. Replaces the old
  // hardcoded "Good news — X is done!" line that logged nothing.
  if (task.customer_id) {
    const rawNote = note
      ? `${task.title} is finished. What the team member reported: "${note}"`
      : `${task.title} is finished and ready.`;
    await notifyCustomer({
      sb, token, business,
      task: { ...task, completion_note: note || task.completion_note },
      rawNote, fileId, milestone: 'completion',
    }).catch(e => console.warn('[delegation] completeTask notifyCustomer:', e.message));
  }

  await postToTeamGroup(token, business, `✅ *${task.title}* — done${task.supplier_name ? ` (${task.supplier_name})` : ''}!`);
  return { ok: true };
}

/**
 * One evaluation pass over a single live delegated task. Called by the hourly
 * cron. Decides the ONE action for this pass and reschedules. Returns a small
 * result describing what it did.
 */
export async function runDelegationPass({ sb, token, business, task }) {
  const now = Date.now();
  const p = task.payload || {};

  // Blocked handling and non-live statuses need no assignee lookup.
  if (task.status === 'blocked') {
    const { action } = decideDelegationAction(task, now);
    if (action === 'blocked_waiting') return { id: task.id, action };
    await escalateToOwner({ sb, token, business, task, reason: `⚠️ Blocked: ${task.blocked_reason || 'assignee reported a blocker'}` });
    return { id: task.id, action: 'escalated_blocked' };
  }
  if (task.status !== 'in_progress') return { id: task.id, action: 'skip', status: task.status };

  const supplier = await loadAssignee(sb, task);
  if (!supplier?.contact_telegram) {
    // Assignee vanished (removed / lost telegram id) — kick back to the owner.
    await escalateToOwner({ sb, token, business, task, reason: 'Assignee is no longer reachable.' });
    return { id: task.id, action: 'escalated_no_assignee' };
  }

  // Defer if we'd be DMing outside the assignee's working hours.
  const openAt = nextOpenTimeMs(supplier.active_hours, now);
  if (openAt > now) {
    await sb.from('agent_tasks').update({ scheduled_at: new Date(openAt).toISOString() }).eq('id', task.id);
    return { id: task.id, action: 'deferred_hours' };
  }

  const dueMs = task.due_at ? Date.parse(task.due_at) : null;
  const { action } = decideDelegationAction(task, now);

  switch (action) {
    case 'accept_ping': {
      await pingAssignee({ token, business, task, supplier,
        directive: `You haven't heard back from ${supplier.name} on whether they can take "${task.title}" on yet. Check in naturally — ask if they saw it / if they can take it on.` });
      await sb.from('agent_tasks').update({
        chase_count: (task.chase_count || 0) + 1,
        last_chased_at: new Date(now).toISOString(),
        scheduled_at: new Date(nextOpenTimeMs(supplier.active_hours, now + ACCEPT_WAIT_MS)).toISOString(),
        payload: { ...p, accept_pings: (p.accept_pings || 0) + 1 },
      }).eq('id', task.id);
      await recordTaskEvent(sb, task, { actor: 'agent', action: 'chased', note: 'acceptance' });
      return { id: task.id, action, ping: (p.accept_pings || 0) + 1 };
    }
    case 'escalate_no_accept':
      await escalateToOwner({ sb, token, business, task, reason: `${supplier.name} hasn't confirmed they're on it.` });
      return { id: task.id, action };
    case 'predue_reminder': {
      const mins = Math.max(1, Math.round((dueMs - now) / 60000));
      const when = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins} min`;
      await pingAssignee({ token, business, task, supplier,
        directive: `"${task.title}" is due in about ${when}. Check in naturally on how it's going — don't sound like an alarm.` });
      await sb.from('agent_tasks').update({
        payload: { ...p, predue_sent: true },
        last_chased_at: new Date(now).toISOString(),
        scheduled_at: new Date(dueMs).toISOString(),
      }).eq('id', task.id);
      await recordTaskEvent(sb, task, { actor: 'agent', action: 'chased', note: 'pre-due reminder' });
      return { id: task.id, action };
    }
    case 'overdue_chase': {
      const chases = task.chase_count || 0;
      await pingAssignee({ token, business, task, supplier,
        directive: `"${task.title}" is now past its deadline${chases > 0 ? ` — you've already checked in ${chases} time${chases > 1 ? 's' : ''}` : ''}. Follow up naturally, a little more directly this time, but still friendly — not a robotic repeat of your last message.` });
      await sb.from('agent_tasks').update({
        chase_count: chases + 1,
        last_chased_at: new Date(now).toISOString(),
        scheduled_at: new Date(nextOpenTimeMs(supplier.active_hours, now + OVERDUE_CHASE_MS)).toISOString(),
      }).eq('id', task.id);
      await recordTaskEvent(sb, task, { actor: 'agent', action: 'chased', note: `overdue #${chases + 1}` });
      return { id: task.id, action, chase: chases + 1 };
    }
    case 'escalate_overdue':
      await escalateToOwner({ sb, token, business, task, reason: `Overdue — ${supplier.name} hasn't responded after ${task.chase_count || 0} chases.` });
      return { id: task.id, action };
    case 'overdue_waiting':
      return { id: task.id, action };
    default: {
      // 'sleep' — accepted, not due yet. Wake near the pre-due window.
      const wake = dueMs ? Math.max(now + HOUR_MS, dueMs - PREDUE_WINDOW_MS) : now + 12 * HOUR_MS;
      await sb.from('agent_tasks').update({ scheduled_at: new Date(wake).toISOString() }).eq('id', task.id);
      return { id: task.id, action: 'sleep' };
    }
  }
}

// ────────────────────────────── High-level entrypoints (tools) ──────────────────────────────
const TEAM_ROLES = ['designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'other'];

/** Resolve an owner's "assignee" phrase (a role, a name, or an @handle) to one supplier row. */
export async function resolveAssigneeQuery(sb, businessId, query) {
  const t = String(query || '').trim().toLowerCase().replace(/^@/, '');
  if (!t) return null;
  if (TEAM_ROLES.includes(t)) {
    const { data } = await sb.from('suppliers')
      .select('id, name, role, contact_telegram, active_hours')
      .eq('business_id', businessId).eq('is_active', true).eq('role', t)
      .not('contact_telegram', 'is', null).limit(1);
    return data?.[0] || null;
  }
  const { data } = await sb.from('suppliers')
    .select('id, name, role, contact_telegram, telegram_username, active_hours')
    .eq('business_id', businessId).eq('is_active', true)
    .or(`name.ilike.%${query}%,telegram_username.ilike.%${t}%`)
    .limit(3);
  return (data || []).find(s => s.contact_telegram) || data?.[0] || null;
}

/**
 * Owner-driven delegation: create a task and route it. If the owner named a
 * specific team member, assign directly; otherwise trust-gate via
 * proposeAssignment. Returns a short owner-facing status string.
 */
export async function delegateFromOwner({ sb, token, business, title, details, assignee_query, due_at, customer_query, created_by = 'owner' }) {
  let customer_id = null;
  let source_conversation_id = null;
  if (customer_query) {
    const { data: cust } = await sb.from('customers')
      .select('id').eq('business_id', business.id)
      .or(`name.ilike.%${customer_query}%,telegram_username.ilike.%${String(customer_query).replace(/^@/, '')}%`)
      .order('last_active_at', { ascending: false }).limit(1).maybeSingle();
    customer_id = cust?.id || null;
    if (customer_id) {
      const { data: conv } = await sb.from('conversations')
        .select('id').eq('business_id', business.id).eq('customer_id', customer_id)
        .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
      source_conversation_id = conv?.id || null;
    }
  }

  // Infer a role hint from the assignee phrase so auto-assign can match.
  const roleHint = TEAM_ROLES.find(r => (assignee_query || '').toLowerCase().includes(r)) || null;

  const created = await createDelegatedTask(sb, business, {
    title, description: details, role: roleHint, due_at, customer_id, source_conversation_id, created_by,
  });
  if (!created.ok) return `❌ Couldn't create that task (${created.error}).`;
  const task = created.task;

  // Named a specific person/role → assign directly.
  if (assignee_query) {
    const supplier = await resolveAssigneeQuery(sb, business.id, assignee_query);
    if (supplier?.contact_telegram) {
      const r = await assignTask({ sb, token, business, task, supplier });
      if (r.ok) {
        return `📋 *${title}* → ${supplier.name}${supplier.role ? ` (${supplier.role})` : ''}. I've briefed them and I'll chase it until it's done${due_at ? ` (due ${new Date(due_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}.`;
      }
      return `⚠️ I created *${title}* but couldn't reach ${supplier.name} — check their Telegram ID in Agent → Team.`;
    }
    // Named someone we don't have → fall back to the picker / trust routing.
    await proposeAssignment({ sb, token, business, task });
    return `📋 *${title}* created. I don't have "${assignee_query}" on your team with a Telegram ID — I've asked you who should take it.`;
  }

  // No assignee named → trust-gated routing.
  const r = await proposeAssignment({ sb, token, business, task });
  if (r?.mode === 'auto' && r.supplier) {
    return `📋 *${title}* → assigned to ${r.supplier.name}. I'll follow up until it's done.`;
  }
  return `📋 *${title}* created — I've asked you who should handle it.`;
}

/** Owner-facing list of live/recent delegated tasks. */
export async function listDelegatedTasks(sb, businessId, query) {
  let q = sb.from('agent_tasks')
    .select('title, status, supplier_name, due_at, blocked_reason')
    .eq('business_id', businessId).eq('type', 'delegated_task')
    .in('status', ['pending', 'in_progress', 'blocked'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(30);
  const { data } = await q;
  let rows = data || [];
  if (query) {
    const ql = String(query).toLowerCase();
    const filtered = rows.filter(t => (t.title || '').toLowerCase().includes(ql) || (t.supplier_name || '').toLowerCase().includes(ql));
    if (filtered.length) rows = filtered;
  }
  if (!rows.length) return '_No delegated tasks in flight. Tell me things like "get Yonas to fix the Dell by 5pm"._';
  const now = Date.now();
  const icon = (t) => t.status === 'blocked' ? '⛔' : (t.due_at && Date.parse(t.due_at) < now) ? '🚨' : t.status === 'in_progress' ? '🔄' : '📋';
  const lines = ['🗂 *Delegated tasks*', ''];
  for (const t of rows) {
    const due = t.due_at ? ` · due ${new Date(t.due_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
    const who = t.supplier_name ? ` — ${t.supplier_name}` : ' — _unassigned_';
    const blk = t.status === 'blocked' && t.blocked_reason ? ` (${t.blocked_reason})` : '';
    lines.push(`${icon(t)} ${t.title}${who}${due}${blk}`);
  }
  return lines.join('\n');
}

// ────────────────────────────── Inbound team-member messages ──────────────────────────────
/**
 * Called from the reply engine BEFORE the supplier-quote short-circuit. Engages
 * only when the sender is an active team member with a live delegated task, and
 * their message reads as a status update (done / progress / blocked / question).
 * Returns true if handled (caller stops); false otherwise so a team member who
 * is also a customer falls through to the normal flow unchanged.
 */
/**
 * Turn whatever a member sent (text, a voice note, a photo, a document) into
 * text teamBrain can reason over, reusing the same extractors the customer
 * path already has (transcription.js). Returns null when the message has no
 * content we understand (e.g. a sticker) or extraction failed outright.
 */
async function normalizeInbound(token, msg) {
  if (msg.text) return { text: msg.text.trim(), kind: 'text' };

  if (msg.voice || msg.audio || msg.video_note) {
    const { transcribeTelegramAudio } = await import('./transcription');
    const tr = await transcribeTelegramAudio(token, msg);
    if (!tr?.text) return null;
    // Prefer the English translation when Addis AI provided one — teamBrain
    // still replies in the member's language, this is just for its own reasoning.
    return { text: tr.translation || tr.text, kind: 'voice' };
  }

  if (msg.photo?.length) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    // Deliberately NOT running the full describeTelegramPhoto vision prompt
    // here — it's written for "what does the customer want", the wrong
    // register for a technician's work photo. A bare photo is itself a strong
    // signal (teamBrain's prompt tells it a bare photo often means done); the
    // caption, if any, carries whatever they meant to add.
    const text = msg.caption ? `(sent a photo) ${msg.caption}` : '(sent a photo, no caption)';
    return { text, kind: 'photo', fileId };
  }

  if (msg.document) {
    const { readTelegramDocument } = await import('./transcription');
    const doc = await readTelegramDocument(token, msg);
    if (!doc) return null;
    return { text: doc, kind: 'document' };
  }

  return null;
}

export async function handleTeamMemberMessage({ sb, token, business, msg, senderId }) {
  try {
    if (!msg.text && !msg.voice && !msg.audio && !msg.video_note && !msg.photo?.length && !msg.document) return false;

    // Must be an active supplier for THIS business.
    const { data: supplier } = await sb.from('suppliers')
      .select('id, name, role, contact_telegram, active_hours, contact_channel, ai_disclosed_at')
      .eq('business_id', business.id)
      .eq('contact_telegram', senderId)
      .eq('is_active', true)
      .maybeSingle();
    if (!supplier) return false;

    // Must have a live task assigned to them. If they replied to a specific
    // brief/chase (reply_to_message), pin THAT task — otherwise fall back to
    // the most recently assigned one.
    const { data: openTasks } = await sb.from('agent_tasks')
      .select('*')
      .eq('business_id', business.id)
      .eq('type', 'delegated_task')
      .eq('supplier_id', supplier.id)
      .in('status', ['in_progress', 'blocked'])
      .order('assigned_at', { ascending: false })
      .limit(20);
    if (!openTasks?.length) return false;
    const task = pickTaskByReply(openTasks, msg.reply_to_message?.message_id) || openTasks[0];

    const inbound = await normalizeInbound(token, msg);
    if (!inbound) return false; // nothing we could extract — let it fall through

    const { runTeamBrain } = await import('./teamBrain');
    const result = await runTeamBrain({
      token, business, supplier, task,
      inboundText: inbound.text, inboundKind: inbound.kind,
    });

    if (result.unrelated) return false; // this member is also a customer right now

    // A bare/captioned photo the model judged as completion proof (set_status
    // just moved the task to 'completed') — attach the actual file bytes,
    // something the tool loop itself can't do.
    if (inbound.kind === 'photo' && inbound.fileId && result.newStatus === 'done') {
      await sb.from('agent_tasks').update({ completion_file_id: inbound.fileId }).eq('id', task.id);
      const ownerChat = ownerChatId(business);
      if (ownerChat) {
        await tg(token, 'sendPhoto', {
          chat_id: ownerChat, photo: inbound.fileId,
          caption: `📸 Proof of work — ${task.title}${supplier.name ? ` (${supplier.name})` : ''}`.slice(0, 200),
        }).catch(() => {});
      }
    }

    return true;
  } catch (e) {
    console.warn('[delegation] handleTeamMemberMessage:', e.message);
    return false;
  }
}

/**
 * A team member sent a photo right after completing a task. If they have a
 * recently-completed delegated task awaiting a photo, attach it and forward the
 * proof to the owner. Returns true if handled.
 */
export async function maybeAttachCompletionPhoto({ sb, token, business, msg, senderId }) {
  try {
    const photos = msg.photo;
    if (!Array.isArray(photos) || !photos.length) return false;
    const fileId = photos[photos.length - 1].file_id; // largest size

    const { data: supplier } = await sb.from('suppliers')
      .select('id, name, contact_telegram').eq('business_id', business.id)
      .eq('contact_telegram', senderId).eq('is_active', true).maybeSingle();
    if (!supplier) return false;

    // A photo that arrives as its OWN message after the task already closed
    // (they said "done" in words, then followed up with the photo separately —
    // handleTeamMemberMessage attaches same-turn photos itself, so this only
    // fires for the split case). No explicit "awaiting a photo" flag exists —
    // teamBrain closes tasks conversationally, not through a button prompt —
    // so treat any of this member's tasks completed recently and still without
    // proof as the natural target. If the photo replied to a specific brief,
    // pin that task instead.
    const recentCutoff = new Date(Date.now() - 6 * 3600000).toISOString();
    const { data: pending } = await sb.from('agent_tasks')
      .select('*').eq('business_id', business.id).eq('type', 'delegated_task')
      .eq('supplier_id', supplier.id).eq('status', 'completed')
      .is('completion_file_id', null)
      .gte('completed_at', recentCutoff)
      .order('completed_at', { ascending: false }).limit(10);
    if (!pending?.length) return false;
    const task = pickTaskByReply(pending, msg.reply_to_message?.message_id) || pending[0];

    await sb.from('agent_tasks').update({ completion_file_id: fileId }).eq('id', task.id);
    await recordTaskEvent(sb, task, { actor: supplier.name, action: 'completed', note: 'photo added' });

    await tg(token, 'sendMessage', { chat_id: supplier.contact_telegram, text: 'Got the photo — thanks! 📸' });
    const chatId = ownerChatId(business);
    if (chatId) {
      await tg(token, 'sendPhoto', {
        chat_id: chatId, photo: fileId,
        caption: `📸 Proof of work — ${task.title}${task.supplier_name ? ` (${task.supplier_name})` : ''}`.slice(0, 200),
      }).catch(() => {});
    }
    return true;
  } catch (e) {
    console.warn('[delegation] maybeAttachCompletionPhoto:', e.message);
    return false;
  }
}
