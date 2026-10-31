/**
 * "Who are these people?" — the owner labels the contacts Secretary can't
 * place, in one card (pure parts).
 *
 * In the last 30 days 67 of 213 Secretary chats had no clear relationship.
 * Secretary then talks to them neutrally — not warm enough for a friend, not
 * helpful enough for a customer. One tap per person fixes that for good.
 */
export const WHO_RELATIONS = {
  family: { emoji: '👨‍👩‍👧', label: 'Family' },
  friend: { emoji: '👫', label: 'Friend' },
  customer: { emoji: '🛒', label: 'Customer' },
  colleague: { emoji: '💼', label: 'Work' },
  ignore: { emoji: '🚫', label: 'Ignore' },
};
const CODE = { family: 'f', friend: 'r', customer: 'c', colleague: 'w', ignore: 'x' };
const FROM_CODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));

/** Chats whose person Secretary couldn't place and the owner hasn't labelled. */
export function unsureContacts(convs, { personalIds = [], max = 6 } = {}) {
  const personal = new Set(personalIds.map(String));
  return (convs || [])
    .filter(c => {
      const cp = c.metadata?.contact_profile;
      if (!cp || cp.owner_set) return false;
      if (cp.relationship && cp.relationship !== 'unknown') return false;
      if (c.customers?.telegram_id && personal.has(String(c.customers.telegram_id))) return false;
      return true;
    })
    .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
    .slice(0, max);
}

const nameOf = (c) => c.metadata?.contact_profile?.name || c.customers?.name || c.customers?.telegram_username || 'Someone';

export function whoCardText(list, total = list.length) {
  if (!list.length) return '✅ *I know who everyone is.* Nobody to sort right now.';
  const lines = ['👥 *Who are these people?*', '', `I'm not sure about ${total === 1 ? 'this person' : `these ${total}`}, so I've been careful with them. One tap each and I'll talk to them the right way from now on.`, ''];
  list.forEach((c, i) => {
    const note = c.metadata?.contact_profile?.notes;
    lines.push(`${i + 1}. *${nameOf(c)}*${note ? ` — _${String(note).slice(0, 70)}_` : ''}`);
  });
  lines.push('', Object.values(WHO_RELATIONS).map(r => `${r.emoji} ${r.label}`).join(' · '));
  return lines.join('\n');
}

/** One row per person: name label + five relation buttons (callback ≤ 64 bytes). */
export function whoKeyboard(list) {
  const rows = [];
  list.forEach((c, i) => {
    rows.push([{ text: `${i + 1}. ${String(nameOf(c)).slice(0, 24)}`, callback_data: 'who_noop' }]);
    rows.push(Object.entries(WHO_RELATIONS).map(([rel, r]) => ({ text: r.emoji, callback_data: `who_${CODE[rel]}_${c.id}` })));
  });
  return rows;
}

export function parseWho(data) {
  const m = String(data || '').match(/^who_([frcwx])_([0-9a-f-]{36})$/);
  return m ? { relation: FROM_CODE[m[1]], conversationId: m[2] } : null;
}

export function whoDoneText(name, relation) {
  const r = WHO_RELATIONS[relation];
  if (relation === 'ignore') return `🚫 Got it — I won't reply to *${name}*.`;
  return `${r.emoji} *${name}* is ${relation === 'colleague' ? 'someone from work' : `a ${r.label.toLowerCase()}`}. I'll talk to them that way from now on.`;
}
