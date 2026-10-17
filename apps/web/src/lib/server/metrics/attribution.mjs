/**
 * Where did each shop come from? First-touch acquisition attribution.
 *
 * Self-reported "how did you hear about us" (businesses.acquisition_source)
 * covers under 5% of shops — most owners skip the question. So we also
 * record the tag on the link they arrived through, with no new client-side
 * tracking: `t.me/MiniMeAgentBot?start=<tag>` (bot) or `?startapp=<tag>`
 * (mini-app) are logged once as onboarding_events step 'entry_link'.
 *
 * Privacy: a tag is a campaign label we chose ("src_tiktok_oct"), sanitised
 * to [a-z0-9_-]; nothing the user typed is stored. Only aggregate channel
 * counts leave the server.
 *
 * Basis, most to least trustworthy: self_reported > entry_link > sell_link >
 * referral > channel_import > unattributed.
 */

export const ENTRY_STEP = 'entry_link';

/** Payloads with their own routing/logging — never counted as entry tags. */
const RESERVED = /^(shop_|team_|sell|msearch|minime_search)/;

/** Sanitised campaign tag from a /start or startapp payload, or null. */
export function entryTag(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(s) || RESERVED.test(s)) return null;
  return s;
}

/**
 * Record a person's first tagged entry. Once per telegram id (first touch
 * wins); untagged, reserved or malformed payloads are ignored. Never throws —
 * telemetry must not break /start or the mini-app.
 */
export async function logEntryLink(sb, telegramId, raw, surface) {
  const tag = entryTag(raw);
  if (!tag || !telegramId) return false;
  try {
    const { data: seen } = await sb.from('onboarding_events').select('id')
      .eq('telegram_id', Number(telegramId)).eq('step', ENTRY_STEP).limit(1);
    if (seen?.length) return false;
    const { error } = await sb.from('onboarding_events')
      .insert({ telegram_id: Number(telegramId), step: ENTRY_STEP, meta: { tag, surface } });
    return !error;
  } catch {
    return false;
  }
}

/** Bucket a tag into the same channel names as acquisition_source. */
export function channelOfTag(tag) {
  const t = String(tag || '').replace(/^(src|utm|c)_/, '');
  if (t.startsWith('ref_')) return 'referral';
  if (/^(tiktok|tt|instagram|insta|ig)/.test(t)) return 'instagram_tiktok';
  if (/^(facebook|fb|meta)/.test(t)) return 'facebook';
  if (/^(google|seo|search)/.test(t)) return 'google_search';
  if (/^(telegram|tg|channel|group)/.test(t)) return 'telegram';
  if (/^(friend|shop|wom)/.test(t)) return 'friend_or_shop';
  return t.split(/[_-]/)[0] || 'other';
}

/**
 * @param businesses rows with id, created_at, owner_telegram_id,
 *   acquisition_source, source_channel_id
 * @param events onboarding_events rows (telegram_id, step, meta, created_at)
 *   for steps entry_link / sell_cta_tapped / referral_signup
 * @returns Map<business id, { channel, basis }>
 */
export function attributeShops(businesses = [], events = []) {
  const first = new Map(); // `${tg}|${kind}` → earliest event
  for (const e of events) {
    if (e?.telegram_id == null) continue;
    const kind = e.step === ENTRY_STEP ? 'entry' : e.step === 'sell_cta_tapped' ? 'sell' : e.step === 'referral_signup' ? 'ref' : null;
    if (!kind) continue;
    const k = `${String(e.telegram_id)}|${kind}`;
    const prev = first.get(k);
    if (!prev || e.created_at < prev.created_at) first.set(k, e);
  }
  // Only a touch at or before the shop was created can have caused it.
  const touch = (b, kind) => {
    const e = first.get(`${String(b.owner_telegram_id)}|${kind}`);
    return e && (!b.created_at || e.created_at <= b.created_at) ? e : null;
  };

  const out = new Map();
  for (const b of businesses) {
    if (!b?.id) continue;
    let r;
    if (b.acquisition_source) r = { channel: b.acquisition_source, basis: 'self_reported' };
    else if (touch(b, 'entry')) r = { channel: channelOfTag(touch(b, 'entry').meta?.tag), basis: 'entry_link' };
    else if (touch(b, 'sell')) r = { channel: 'minime_search', basis: 'sell_link' };
    else if (touch(b, 'ref')) r = { channel: 'referral', basis: 'referral' };
    else if (b.source_channel_id) r = { channel: 'telegram', basis: 'channel_import' };
    else r = { channel: 'unattributed', basis: 'unattributed' };
    out.set(b.id, r);
  }
  return out;
}
