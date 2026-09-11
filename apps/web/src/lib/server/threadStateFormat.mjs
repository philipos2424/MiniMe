/**
 * Thread state — the pure half: refresh policy and prompt rendering.
 *
 * Split out of threadState.js so it can be imported by node:test. That file
 * pulls in the Supabase client and the LLM wrapper through extensionless
 * imports only the Next bundler resolves, which makes everything in it
 * untestable; none of the logic below needs either.
 *
 * See threadState.js for what the state is and why it exists.
 */

// How many turns may pass without a refresh when nothing is pending. While we
// ARE waiting on something the state is live and changes every turn, so it is
// refreshed every turn instead — see shouldUpdateThreadState.
export const IDLE_REFRESH_EVERY = 3;

/**
 * How many turns have arrived since the state was last written.
 *
 * Derived from message ids rather than a stored counter so it costs no extra
 * write: we recorded which message we were current through, so its distance
 * from the end of the window IS the number of turns since. Returns Infinity
 * when that message is no longer in the window (state is very stale) or when
 * there is no state at all.
 */
export function turnsSinceUpdate(state, recentMessages) {
  if (!state?.updated_through) return Infinity;
  const msgs = recentMessages || [];
  const idx = msgs.findIndex(m => m.id === state.updated_through);
  if (idx === -1) return Infinity;
  return msgs.length - 1 - idx;
}

/**
 * Refresh policy.
 *
 * - No state yet → always build one.
 * - Something is pending (`awaiting`, or unanswered questions) → every turn.
 *   This is the case that matters: the pending thing gets answered or dropped
 *   from one message to the next, and a stale "still waiting on the OTP" is
 *   worse than no state at all.
 * - Otherwise → every IDLE_REFRESH_EVERY turns, to keep the cost negligible.
 */
export function shouldUpdateThreadState(state, recentMessages) {
  if (!state) return true;
  const since = turnsSinceUpdate(state, recentMessages);
  if (since === 0) return false;
  const pending = !!state.awaiting || (state.open_questions || []).length > 0;
  return pending ? since >= 1 : since >= IDLE_REFRESH_EVERY;
}

export function isEmptyThreadState(s) {
  return !s || (!s.goal && !s.awaiting && !s.product_focus
    && !(s.open_questions || []).length
    && !(s.commitments || []).length
    && !Object.keys(s.known || {}).length);
}

/** Normalize whatever the model returned into the shape the renderer expects. */
export function coerceThreadState(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const str = v => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, 200) : null);
  const arr = v => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 5) : []);
  const known = {};
  if (parsed.known && typeof parsed.known === 'object' && !Array.isArray(parsed.known)) {
    for (const [k, v] of Object.entries(parsed.known).slice(0, 12)) {
      const val = str(typeof v === 'string' ? v : JSON.stringify(v));
      if (val && k) known[String(k).slice(0, 40)] = val;
    }
  }
  return {
    goal: str(parsed.goal),
    awaiting: str(parsed.awaiting),
    open_questions: arr(parsed.open_questions),
    known,
    product_focus: str(parsed.product_focus),
    commitments: arr(parsed.commitments),
  };
}

/**
 * Render the state for a prompt. Returns '' when there is nothing worth saying,
 * so a fresh chat pays nothing for it.
 */
export function renderThreadState(state) {
  if (isEmptyThreadState(state)) return '';
  const lines = [];
  if (state.goal) lines.push(`- They're trying to: ${state.goal}`);
  if (state.product_focus) lines.push(`- Currently about: ${state.product_focus}`);
  if (state.awaiting) {
    lines.push(`- YOU ARE WAITING ON: ${state.awaiting}. If their message gives it — even as a bare number, word, or photo with no explanation — that IS the answer. Act on it. Do not ask what it is.`);
  }
  const open = (state.open_questions || []).filter(Boolean);
  if (open.length) {
    lines.push(`- Already asked, still unanswered: ${open.map(q => `"${q}"`).join(', ')}. Don't ask these again — if they've moved on, move on with them.`);
  }
  const known = Object.entries(state.known || {});
  if (known.length) {
    lines.push(`- They have ALREADY TOLD YOU: ${known.map(([k, v]) => `${k}: ${v}`).join(' · ')}. Never ask for any of these again.`);
  }
  const commitments = (state.commitments || []).filter(Boolean);
  if (commitments.length) {
    lines.push(`- You committed to: ${commitments.map(c => `"${c}"`).join(', ')}. Honour it, or say where it stands.`);
  }
  if (!lines.length) return '';
  return `\n\n## WHERE THIS CONVERSATION IS RIGHT NOW\n${lines.join('\n')}\n`;
}
