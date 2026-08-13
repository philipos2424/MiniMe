/**
 * Channel abstraction — send as the owner's personal Telegram account when
 * proven possible, always falling back to the bot when it isn't. Every
 * outbound to a team member or a client should go through this so identity
 * selection lives in exactly one place.
 *
 * The constraint driving this: Telegram's Business API only lets a bot send
 * into chats a business connection already covers, and there is no API to
 * enumerate that coverage — it can only be observed from inbound
 * business_message traffic. So "send as the owner" is opportunistic, not
 * guaranteed: cold outreach as the owner is impossible (Telegram-side, not
 * fixable here). We persist coverage as we see it (biz_conn_chats,
 * recordBizConnChat below, called from the business_message webhook branch)
 * and consult it before ever attempting a personal-identity send.
 *
 * Business connections belong to the SHARED @MiniMeAgentBot only — a tenant's
 * own bot token can never be used with business_connection_id attached, even
 * if the tenant has their own bot. Mixing them (as a couple of call sites
 * used to) causes Telegram to reject the send outright.
 */
import { decrypt } from './crypto';
import { runWithBizConn, tg } from './telegramApi';
import { shouldTryPersonal, pickToken } from './sendAsLogic.mjs';

const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

/** Resolve the right token for a send. `as`: 'owner' | 'bot'. */
export function resolveToken(business, { as = 'bot' } = {}) {
  let tenantToken = null;
  if (business?.telegram_bot_token_enc) {
    try { tenantToken = decrypt(business.telegram_bot_token_enc); } catch { tenantToken = null; }
  }
  return pickToken(as, { tenantToken, sharedToken: AGENT_TOKEN || null });
}

/** Load the coverage row for (business, chat), or null. */
async function loadCoverage(sb, businessId, chatId) {
  const { data } = await sb.from('biz_conn_chats')
    .select('*').eq('business_id', businessId).eq('chat_id', chatId).maybeSingle();
  return data || null;
}

/**
 * Record that we've seen (or attempted) traffic on a chat covered by a
 * business connection. Called from the business_message webhook branch
 * (real signal of coverage) and from sendAsOwnerOrBot itself (to stamp
 * send_ok_at / send_failed_at after an attempt).
 */
export async function recordBizConnChat(sb, { businessId, chatId, connId, ok, failed }) {
  if (!businessId || !chatId) return;
  const patch = {
    business_id: businessId, chat_id: chatId,
    conn_id: connId || null,
    last_seen_at: new Date().toISOString(),
  };
  if (ok) patch.send_ok_at = new Date().toISOString();
  if (failed) patch.send_failed_at = new Date().toISOString();
  try {
    await sb.from('biz_conn_chats').upsert(patch, { onConflict: 'business_id,chat_id' });
  } catch (e) {
    console.warn('[sendAs] recordBizConnChat:', e.message);
  }
}

/**
 * Send to chatId as the owner's personal account when eligible, otherwise (or
 * on failure) as the bot. Never silently drops — this is the whole point.
 *
 * @param {object} opts
 * @param {object} opts.sb - supabase client
 * @param {object} opts.business
 * @param {number|string} opts.chatId
 * @param {string} opts.method - Telegram method, e.g. 'sendMessage'
 * @param {object} opts.payload - method body minus chat_id/business_connection_id
 * @param {'auto'|'bot'|'personal'} [opts.prefer]
 * @returns {Promise<{ ok: boolean, sent_as: 'owner'|'bot', result?: object }>}
 */
export async function sendAsOwnerOrBot({ sb, business, chatId, method = 'sendMessage', payload, prefer = 'auto' }) {
  const coverage = await loadCoverage(sb, business.id, chatId);
  const tryPersonal = shouldTryPersonal({ prefer, bizConnId: business.telegram_biz_conn_id, coverage });

  if (tryPersonal) {
    const ownerToken = resolveToken(business, { as: 'owner' });
    if (ownerToken) {
      const res = await runWithBizConn(business.telegram_biz_conn_id, () =>
        tg(ownerToken, method, { chat_id: chatId, ...payload }));
      if (res?.ok) {
        await recordBizConnChat(sb, { businessId: business.id, chatId, connId: business.telegram_biz_conn_id, ok: true });
        return { ok: true, sent_as: 'owner', result: res };
      }
      // Fell through — record the failure and retry as the bot below. This is
      // the fallback that previously didn't exist: a rejected personal send
      // used to just vanish (telegramApi.js logs a warning and stops).
      await recordBizConnChat(sb, { businessId: business.id, chatId, connId: business.telegram_biz_conn_id, failed: true });
    }
  }

  const botToken = resolveToken(business, { as: 'bot' });
  if (!botToken) return { ok: false, sent_as: 'bot', error: 'no_token' };
  const res = await tg(botToken, method, { chat_id: chatId, ...payload });
  return { ok: !!res?.ok, sent_as: 'bot', result: res };
}
