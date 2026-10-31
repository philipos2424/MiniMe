/**
 * How an owner refers to another business (pure, no I/O).
 *
 * The business list told owners to "connect me with @username", but most
 * shops run on the shared bot and have no @username — so most listed
 * businesses could not be reached at all. Now an owner can say a number
 * from the list, a name, an @username, or a shop code.
 */

/** Shop code from "shop_0b70f6ec", "t.me/MiniMeAgentBot?start=shop_0b70f6ec" or "0b70f6ec". */
export function shopCodeFrom(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/start=shop_([A-Za-z0-9]+)/) || s.match(/^shop_([A-Za-z0-9]+)$/i) || s.match(/^([a-f0-9]{8})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** { kind: 'index', index } | { kind: 'handle', value } | { kind: 'name', value } | null */
export function parseTargetRef(raw) {
  const s = String(raw || '').trim().replace(/^(the\s+)?(number|no\.?)\s*/i, '');
  if (!s) return null;
  const idx = s.match(/^#?\s*(\d{1,2})(st|nd|rd|th)?$/i);
  if (idx) return { kind: 'index', index: Number(idx[1]) };
  if (/^@|t\.me\/|^shop_|^[a-f0-9]{8}$/i.test(s) || /_bot$/i.test(s)) return { kind: 'handle', value: s };
  return { kind: 'name', value: s.replace(/^["'“”]|["'“”]$/g, '').slice(0, 120) };
}

/** How a listed business can be contacted, shown next to its name. */
export function contactHint(biz) {
  if (biz?.telegram_bot_username) return `@${biz.telegram_bot_username}`;
  if (biz?.shop_code) return `code ${biz.shop_code}`;
  return '';
}
