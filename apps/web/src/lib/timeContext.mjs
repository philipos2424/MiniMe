/**
 * What time it is, and how much time passed between messages (pure).
 *
 * Replies were written with no idea of the clock: no date or time in the
 * reply prompts and no timestamps on the chat history. So "good morning" went
 * out at 10pm, "see you tomorrow" from three days ago read as today, and a
 * person writing again after a week got an answer that carried on as if they
 * had never left. Ethiopia is UTC+3 all year, no DST.
 */
const EAT_MS = 3 * 3600 * 1000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const local = (t) => new Date(new Date(t).getTime() + EAT_MS);
const dayIndex = (t) => Math.floor((new Date(t).getTime() + EAT_MS) / DAY);

export function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** "Saturday 31 October 2026, 3:31 pm (afternoon)" in Addis Ababa time. */
export function nowLine(now = new Date()) {
  const d = local(now);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const h12 = ((h + 11) % 12) + 1;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h12}:${m} ${h < 12 ? 'am' : 'pm'} (${partOfDay(h)})`;
}

/** Human gap between two messages, or null when it's just a normal pause. */
export function gapLabel(prevAt, curAt) {
  if (!prevAt || !curAt) return null;
  const ms = new Date(curAt) - new Date(prevAt);
  if (!(ms >= 3 * HOUR)) return null;
  const days = dayIndex(curAt) - dayIndex(prevAt);
  if (days <= 0) return `${Math.round(ms / HOUR)} hours later`;
  if (days === 1) return `next day, ${DAYS[local(curAt).getUTCDay()]}`;
  if (days < 14) return `${days} days later, ${DAYS[local(curAt).getUTCDay()]}`;
  if (days < 60) return `${Math.round(days / 7)} weeks later`;
  return `${Math.round(days / 30)} months later`;
}

/**
 * A "[3 days later, Tuesday]" marker for each message that follows a real gap,
 * aligned with the messages array (null where none).
 */
export function gapMarkers(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m, i) => (i === 0 ? null : gapLabel(list[i - 1]?.created_at, m?.created_at)));
}

/** Prefix a message's text with its gap marker, if any. */
export const withGap = (content, label) => (label ? `[${label}] ${content}` : content);

/**
 * The block every reply prompt gets: the current day/time, and how long it's
 * been since the last message before this one.
 */
export function timeBlock(history, now = new Date()) {
  const list = (Array.isArray(history) ? history : []).filter(m => m?.created_at);
  const last = list[list.length - 1];
  const lines = [`## TIME\nRight now it is ${nowLine(now)} in Ethiopia (Addis Ababa time).`,
    'Greet for the real time of day (no "good morning" in the evening). "Today", "tomorrow" and weekdays in older messages mean what they meant on the day they were written — the chat marks gaps like [3 days later].'];
  const gap = last ? gapLabel(last.created_at, now) : null;
  if (gap) {
    lines.push(`The last message in this chat before this one was ${gap.replace(/ later.*/, '')} ago — they are coming back after a break. Pick up naturally (a warm "good to hear from you again" fits if it's been days); don't continue a half-finished thought as if no time passed, and check anything time-sensitive from before (a delivery, a plan, a price) instead of assuming it still stands.`);
  }
  return lines.join('\n');
}
