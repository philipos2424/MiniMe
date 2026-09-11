/**
 * tiktokEvents.js — turn a raw TikTok Business Messaging webhook body into
 * inbound messages and feed each one into handleTikTokMessage.
 *
 * Mirrors metaEvents.js. The payload shape is normalized first by the pure
 * parser in tiktokLogic.mjs; everything here is the database side: find the
 * business the event belongs to, then hand it to the reply engine.
 */
import { supabase } from './db';
import { parseTikTokEvent } from './tiktokLogic.mjs';
import { handleTikTokMessage } from './tiktokReplyEngine';

// Same column set the Meta path selects, plus the TikTok connection columns.
const BIZ_FIELDS = 'id, name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, brain_mode, panic_mode, trust_level, notification_prefs, owner_instructions, sample_replies, subscription_status, trial_ends_at, plan_tier, tiktok_business_id, tiktok_username, tiktok_access_token_enc, tiktok_refresh_token_enc, tiktok_token_expires_at';

/**
 * @param {object} body — raw TikTok webhook payload
 * @returns {Promise<{processed: number, skipped: string[]}>} — counts for the
 *   route's log line, so a delivery that produced nothing says why.
 */
export async function processTikTokEvent(body) {
  const { events, skipped } = parseTikTokEvent(body);
  if (!events.length) return { processed: 0, skipped };

  // One lookup per business, not per message: a batch usually carries several
  // messages for the same account.
  const cache = new Map();
  let processed = 0;

  for (const ev of events) {
    let business = cache.get(ev.businessId);
    if (business === undefined) {
      const { data } = await supabase()
        .from('businesses')
        .select(BIZ_FIELDS)
        .eq('tiktok_business_id', ev.businessId)
        .maybeSingle();
      business = data || null;
      cache.set(ev.businessId, business);
    }
    if (!business) {
      skipped.push(`no business connected for tiktok_business_id ${ev.businessId}`);
      continue;
    }

    await handleTikTokMessage({
      business,
      senderId: ev.senderId,
      senderName: ev.senderName,
      messageId: ev.messageId,
      conversationId: ev.conversationId,
      text: ev.text,
    });
    processed++;
  }

  return { processed, skipped };
}
