/**
 * Natural language schedule parser for the /schedule command.
 * Parses strings like:
 *   "tomorrow 9am all Flash sale!"
 *   "Friday 6pm ordered Your order is ready"
 *   "in 2 hours gold Special gift"
 *   "2026-05-25 10:00 all Big announcement"
 */

const SEGMENTS = new Set(['all', 'ordered', 'never_ordered', 'gold', 'silver', 'inactive', 'buyers', 'vip']);

const SEGMENT_MAP = {
  all: 'all', everyone: 'all', all_customers: 'all',
  ordered: 'ordered', buyers: 'ordered', buyer: 'ordered',
  never_ordered: 'never_ordered', new: 'never_ordered',
  gold: 'gold', vip: 'gold', top: 'gold',
  silver: 'silver',
  inactive: 'inactive', inactive_30d: 'inactive',
};

function parseTime(str, baseDate = new Date()) {
  // EAT = UTC+3
  const eatOffset = 3 * 60 * 60 * 1000;
  const now = new Date(baseDate.getTime());

  // "in X hours/minutes"
  const inMatch = str.match(/^in\s+(\d+)\s+(hour|minute|min|hr)s?$/i);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const ms = (unit.startsWith('h') || unit === 'hr') ? n * 3600000 : n * 60000;
    return new Date(now.getTime() + ms);
  }

  // "today HH:mm" or "today 9am"
  // "tomorrow HH:mm"
  // "monday/tuesday/... HH:mm"
  // "YYYY-MM-DD HH:mm"

  // Extract time part (9am, 6pm, 14:00, 9:30am)
  const timePart = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let hours = 9, minutes = 0;
  if (timePart) {
    hours = parseInt(timePart[1]);
    minutes = timePart[2] ? parseInt(timePart[2]) : 0;
    const meridiem = timePart[3]?.toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }

  // Extract date part
  const lower = str.toLowerCase();
  const result = new Date(now);

  if (lower.startsWith('today')) {
    result.setHours(hours, minutes, 0, 0);
  } else if (lower.startsWith('tomorrow')) {
    result.setDate(result.getDate() + 1);
    result.setHours(hours, minutes, 0, 0);
  } else if (/^(mon|tue|wed|thu|fri|sat|sun)/i.test(lower)) {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const target = days.findIndex(d => lower.startsWith(d));
    if (target >= 0) {
      const current = result.getDay();
      let diff = target - current;
      if (diff <= 0) diff += 7; // always next week if same day or past
      result.setDate(result.getDate() + diff);
      result.setHours(hours, minutes, 0, 0);
    }
  } else {
    // Try YYYY-MM-DD or DD/MM/YYYY
    const isoMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    const dmyMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (isoMatch) {
      result.setFullYear(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
      result.setHours(hours, minutes, 0, 0);
    } else if (dmyMatch) {
      result.setFullYear(parseInt(dmyMatch[3]), parseInt(dmyMatch[2]) - 1, parseInt(dmyMatch[1]));
      result.setHours(hours, minutes, 0, 0);
    } else {
      // Just a time → today if in future, tomorrow if past
      result.setHours(hours, minutes, 0, 0);
      if (result <= now) result.setDate(result.getDate() + 1);
    }
  }

  // Convert from EAT to UTC (subtract 3 hours to store as UTC)
  // Actually, store as the local time the user specified (EAT)
  // The cron comparison is done in UTC so we need to subtract 3h
  return new Date(result.getTime() - eatOffset);
}

export function parseScheduleCommand(input) {
  const tokens = input.trim().split(/\s+/);

  // Try to extract "when" portion (1-3 tokens) and "target" (1 token) and "message" (rest)
  // Strategy: scan tokens to find known segment keywords, everything before is "when", after is message

  let whenTokens = [];
  let targetType = 'all';
  let targetValue = null;
  let messageStart = 0;

  // Look for segment keyword in first 5 tokens
  for (let i = 0; i < Math.min(tokens.length, 5); i++) {
    const t = tokens[i].toLowerCase();
    if (SEGMENT_MAP[t]) {
      targetType = SEGMENT_MAP[t];
      targetValue = targetType === 'all' ? null : targetType;
      whenTokens = tokens.slice(0, i);
      messageStart = i + 1;
      break;
    }
    // Check @username as target
    if (tokens[i].startsWith('@') && i > 0) {
      targetType = 'customer';
      targetValue = tokens[i].slice(1);
      whenTokens = tokens.slice(0, i);
      messageStart = i + 1;
      break;
    }
  }

  // If no segment found, assume "all" and everything after time is the message
  if (!whenTokens.length && messageStart === 0) {
    // Try to find where message starts: after the time tokens (max 3)
    const timeTokenCount = Math.min(3, tokens.length);
    whenTokens = tokens.slice(0, timeTokenCount);
    messageStart = timeTokenCount;
    targetType = 'all';
  }

  const whenStr = whenTokens.join(' ');
  const message = tokens.slice(messageStart).join(' ').trim();
  const sendAt = parseTime(whenStr);

  return { sendAt, targetType, targetValue, message, label: null };
}
