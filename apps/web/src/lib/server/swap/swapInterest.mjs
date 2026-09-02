/**
 * The handshake: one tap, one sentence, two @handles.
 *
 * Handles are revealed without the lister approving anything — but a tap costs
 * an offer line first. That line does two jobs: it filters out drive-by taps,
 * and it turns the lister's notification from an alarm ("someone has your
 * handle") into information ("someone is offering a Nikon").
 *
 * After the reveal MiniMe is out of the loop, so `recordReport` is the only
 * lever left. Three distinct reporters hide the post.
 */
import { REPORTS_TO_HIDE } from './constants.mjs';

const M = {
  en: {
    seeker: (u, title) => `${u} — message them and offer your swap.\n\nSay what you're offering in your first message.`,
    lister: (u, title, offer) => `👀 @${u} is interested in your *${title}* — offering: _${offer}_.\n\nThey may message you.`,
  },
  am: {
    seeker: (u, title) => `${u} — መልእክት ይላኩላቸው።\n\nበመጀመሪያ መልእክትዎ የሚያቀርቡትን ይግለጹ።`,
    lister: (u, title, offer) => `👀 @${u} *${title}* ላይ ፍላጎት አለው — ያቀርባል: _${offer}_።\n\nመልእክት ሊልክልዎ ይችላል።`,
  },
};

/** The two halves of the reveal, sent to the two people at the same moment. */
export function revealText({ item, offerText, fromUsername, lang = 'en' }) {
  const m = M[lang === 'am' ? 'am' : 'en'];
  return {
    toSeeker: m.seeker(`@${item.telegram_username}`, item.title),
    toLister: m.lister(fromUsername, item.title, offerText),
  };
}

/**
 * Record one person's interest in one item. Returns the item on success so the
 * caller can render the reveal without a second read.
 */
export async function recordInterest(sb, { itemId, fromUserId, fromUsername, offerText }) {
  const { data: item } = await sb.from('swap_items')
    .select('id, title, wants_text, telegram_user_id, telegram_username, lang, status, interest_count, first_reveal_at')
    .eq('id', itemId).maybeSingle();

  // Missing status (as in a bare item row) is treated as active; only an
  // explicit non-active status (e.g. 'hidden', 'expired') fails closed.
  if (!item || (item.status && item.status !== 'active')) return { error: 'not_found' };
  if (String(item.telegram_user_id) === String(fromUserId)) return { error: 'own_item' };
  // No @handle means no reachable person. Revealing one is a dead end that
  // reads as a bug to both sides, so refuse before anything is written.
  if (!item.telegram_username) return { error: 'no_username' };

  const { error } = await sb.from('swap_interests').insert({
    swap_item_id: itemId,
    from_telegram_user_id: fromUserId,
    from_telegram_username: fromUsername || null,
    offer_text: String(offerText || '').slice(0, 200),
  });
  if (error) return { error: error.code === '23505' ? 'duplicate' : 'save_failed' };

  return { ok: true, item };
}

/** Record a report; hide the post once enough distinct people have filed one. */
export async function recordReport(sb, { itemId, reporterUserId, reportedUserId, reason }) {
  await sb.from('swap_reports').insert({
    swap_item_id: itemId,
    reporter_telegram_user_id: reporterUserId,
    reported_telegram_user_id: reportedUserId,
    reason: reason ? String(reason).slice(0, 200) : null,
  });

  const { count } = await sb.from('swap_reports')
    .select('id', { count: 'exact', head: true })
    .eq('swap_item_id', itemId);

  const total = count || 0;
  if (total >= REPORTS_TO_HIDE) {
    await sb.from('swap_items').update({ status: 'hidden' }).eq('id', itemId);
    return { hidden: true, count: total };
  }
  return { hidden: false, count: total };
}
