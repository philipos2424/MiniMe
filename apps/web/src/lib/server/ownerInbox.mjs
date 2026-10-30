/**
 * The owner's inbox and order lists as bot-chat messages. Pure formatting and
 * classification, so it can be tested; the database reads live in
 * ownerCommands.js.
 *
 * Why: asked "who messaged me today and is anyone waiting for a reply?", the
 * owner agent had no inbox tool, so it answered with the /orders dump (jobs
 * from months ago, "step 0 · draft", the same job repeated 3–4 times) and
 * "No delegated tasks in flight". It never named the three people who had
 * actually messaged that day. Separately, 225 conversations on the platform
 * are flagged send_failed: the customer never got the reply, and nothing told
 * the owner.
 */

// Why a conversation needs the owner, from conversations.last_ai_action.
const NEEDS_YOU = {
  send_failed:  'my reply didn’t reach them',
  reply_failed: 'my reply didn’t reach them',
  drafted:      'a draft is waiting for your OK',
  asked_owner:  'I asked you a question about this',
  loop_paused:  'I paused replies here',
};

const UNANSWERED_AFTER_MS = 10 * 60 * 1000;

/**
 * @param conv  { requires_owner, last_ai_action, last_message_at }
 * @param last  latest message { direction, created_at } or null
 * @returns { needsYou: boolean, reason: string|null }
 */
export function classifyConversation(conv, last, now = Date.now()) {
  const action = conv?.last_ai_action;
  if (NEEDS_YOU[action] && conv?.requires_owner !== false) return { needsYou: true, reason: NEEDS_YOU[action] };
  if (conv?.requires_owner) return { needsYou: true, reason: 'flagged for you' };
  if (last?.direction === 'inbound' && now - Date.parse(last.created_at) > UNANSWERED_AFTER_MS) {
    return { needsYou: true, reason: 'no reply yet' };
  }
  return { needsYou: false, reason: null };
}

function who(c) {
  const name = c?.customers?.name?.trim();
  const user = c?.customers?.telegram_username;
  return name || (user ? `@${user}` : 'Someone');
}

function ago(iso, now) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function clip(s, n = 60) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * @param rows [{ conv, last }] for conversations active in the window, newest first
 * @param opts { hours, appUrl, now }
 */
export function formatInbox(rows, { hours = 24, appUrl = '', now = Date.now() } = {}) {
  const window = hours === 24 ? 'today' : `in the last ${hours}h`;
  if (!rows.length) return `📭 *Nobody has messaged ${window}.*`;
  const waiting = [];
  const handled = [];
  for (const r of rows) {
    const k = classifyConversation(r.conv, r.last, now);
    (k.needsYou ? waiting : handled).push({ ...r, reason: k.reason });
  }
  const lines = [`📥 *${rows.length} ${rows.length === 1 ? 'person' : 'people'} messaged ${window}*`];
  if (waiting.length) {
    lines.push('', `*Waiting on you (${waiting.length})*`);
    for (const r of waiting.slice(0, 10)) {
      const said = r.last?.direction === 'inbound' && r.last?.content ? ` — “${clip(r.last.content)}”` : '';
      lines.push(`• ${who(r.conv)} · ${r.reason} · ${ago(r.conv.last_message_at, now)}${said}`);
    }
    if (waiting.length > 10) lines.push(`…and ${waiting.length - 10} more`);
  } else {
    lines.push('', '✅ Nobody is waiting on you.');
  }
  if (handled.length) {
    lines.push('', `*Handled by MiniMe (${handled.length})*`);
    lines.push(handled.slice(0, 8).map(r => who(r.conv)).join(', ') + (handled.length > 8 ? `, +${handled.length - 8} more` : ''));
  }
  if (appUrl) lines.push('', `[Open Chats →](${appUrl.replace(/\/$/, '')}/conversations)`);
  return lines.join('\n');
}

const JOB_STATUS = {
  draft: 'not started',
  active: 'in progress',
  awaiting_approval: 'needs your OK',
  blocked: 'stuck',
};

/**
 * /orders as something an owner can read: orders grouped by what to do next,
 * customer jobs deduped with plain status words, capped, with a link for the rest.
 */
export function formatOrders({ orders = [], jobs = [] }, { appUrl = '', maxJobs = 8 } = {}) {
  const name = x => x?.customers?.name?.trim() || (x?.customers?.telegram_username ? `@${x.customers.telegram_username}` : 'Customer');
  const lines = ['🛒 *Orders & jobs*'];
  const unpaid = orders.filter(o => o.status === 'pending_payment');
  const paid = orders.filter(o => o.status === 'paid');
  if (!orders.length && !jobs.length) return `${lines[0]}\n\n_Nothing open right now._`;
  const money = o => `${Number(o.total || 0).toLocaleString()} ${o.currency || 'ETB'}`;
  if (unpaid.length) {
    lines.push('', `*Waiting for payment (${unpaid.length})*`);
    for (const o of unpaid.slice(0, 8)) lines.push(`• ${name(o)} — ${money(o)}`);
  }
  if (paid.length) {
    lines.push('', `*Paid, to deliver (${paid.length})*`);
    for (const o of paid.slice(0, 8)) lines.push(`• ${name(o)} — ${money(o)}`);
  }
  // Same customer + same title = the same job created more than once.
  const seen = new Set();
  const unique = [];
  for (const j of jobs) {
    const key = `${name(j).toLowerCase()}|${String(j.title || '').toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(j);
  }
  if (unique.length) {
    lines.push('', `*Customer jobs (${unique.length})*`);
    for (const j of unique.slice(0, maxJobs)) {
      const budget = j.budget ? ` · ${Number(j.budget).toLocaleString()} ${j.currency || 'ETB'}` : '';
      lines.push(`• ${name(j)} — ${clip(j.title, 50)}${budget} · ${JOB_STATUS[j.status] || j.status}`);
    }
    if (unique.length > maxJobs) lines.push(`…and ${unique.length - maxJobs} more`);
  }
  if (appUrl) lines.push('', `[See everything in the app →](${appUrl.replace(/\/$/, '')}/progress)`);
  return lines.join('\n');
}

/** What the owner can do from the bot chat. */
export function ownerHelpText(ownerFirstName = '') {
  return [
    `👋 *${ownerFirstName ? `Hi ${ownerFirstName}! ` : ''}Here's what you can ask me*`,
    '',
    'Just type it — no commands needed:',
    '• “Who messaged me today?” — your inbox, and who’s waiting on you',
    '• “What orders do I have?” — orders and customer jobs',
    '• “How were sales this week?”',
    '• “Tell Abebe his card is ready” — I message a customer for you',
    '• “Remind me to call the printer at 3pm”',
    '• “Plan my day”',
    '',
    '*Teach me*',
    '• “Add injera 45 birr” — or send a photo captioned _Red dress 1500 birr_ — it goes in your catalog',
    '• “We deliver on Saturdays” — I’ll tell customers who ask',
    '• Send a photo, PDF, link or voice note — I’ll learn from it',
    '• /preview _question_ — see exactly what a customer would get',
    '',
    '*Control*',
    '• /pause and /resume — stop or restart my replies',
    '• /status — is everything working?',
  ].join('\n');
}

/**
 * People Secretary is holding — new contacts it hasn't answered because it's
 * waiting for the owner to say who they are. "Who's waiting on me?" said
 * "Nobody has messaged today" while two of these sat unanswered.
 * `pending` is notification_prefs.pending_contacts, already pruned.
 */
export function heldContactsText(pending, { now = Date.now(), max = 8 } = {}) {
  const rows = Object.values(pending || {})
    .filter(e => e && (e.name || e.text))
    .sort((a, b) => new Date(b.at || b.asked_at || 0) - new Date(a.at || a.asked_at || 0));
  if (!rows.length) return '';
  const ago = t => {
    const m = Math.max(0, Math.round((now - new Date(t).getTime()) / 60000));
    return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  const lines = [`🛑 *Waiting for you to say who they are (${rows.length})* — I haven't replied to them:`];
  for (const e of rows.slice(0, max)) {
    const snippet = String(e.text || '').replace(/\s+/g, ' ').slice(0, 60);
    lines.push(`• *${String(e.name || 'Someone').slice(0, 40)}*${snippet ? ` — “${snippet}”` : ''}${e.at || e.asked_at ? ` _(${ago(e.at || e.asked_at)})_` : ''}`);
  }
  if (rows.length > max) lines.push(`…and ${rows.length - max} more`);
  lines.push('_Tap Customer / Family / Friend on their card above, or switch Secretary Mode to Smart so I answer clear customers myself._');
  return lines.join('\n');
}
