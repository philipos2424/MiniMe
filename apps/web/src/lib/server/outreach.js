/**
 * Shared segment-selection + broadcast-send logic for platform-to-owner
 * outreach. Extracted from api/admin/notify-owners/route.js so the manual
 * campaign composer (api/admin/outreach/campaigns) and the existing
 * notify-owners panel share one implementation instead of diverging.
 *
 * Behavior is unchanged from the original inline version — this is a pure
 * extraction, not a rewrite.
 */
import { randomUUID } from 'node:crypto';
import { supabase } from './db';
import { fetchAllRows, fetchAllRowsForIds } from './fetch-all.mjs';
import { sendTelegramMessage, floodBreaker } from './telegram-send.mjs';

export const ALLOWED_SEGMENTS = ['all', 'shared', 'linked', 'inactive_7d', 'no_products', 'never_taught', 'incomplete_onboarding'];
export const ACTIVE_WINDOW_MS = 7 * 86400000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function selectRecipients(segment) {
  const sb = supabase();

  // "Incomplete onboarding" is the inverse of every other segment — they
  // started signup (so we already have a Telegram id to DM) but never
  // finished, which is also WHY they're invisible in MiniMe Search (the
  // search filter requires onboarding_completed=true). Separate base query
  // since every other segment requires the opposite condition.
  if (segment === 'incomplete_onboarding') {
    const { data } = await fetchAllRows(() => sb.from('businesses')
      .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_username, shop_code, updated_at, created_at, notification_prefs')
      .not('owner_telegram_id', 'is', null)
      .or('onboarding_completed.is.null,onboarding_completed.eq.false')
      .order('created_at', { ascending: true }));
    return data || [];
  }

  // Base: every onboarded owner who has an owner_telegram_id (so we can DM them).
  let q = sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_username, shop_code, updated_at, created_at, notification_prefs')
    .eq('onboarding_completed', true)
    .not('owner_telegram_id', 'is', null);

  if (segment === 'shared')      q = q.is('telegram_bot_username', null).not('shop_code', 'is', null);
  if (segment === 'linked')      q = q.not('telegram_bot_username', 'is', null);
  if (segment === 'inactive_7d') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    q = q.lt('updated_at', sevenDaysAgo);
  }

  q = q.order('created_at', { ascending: true });
  // Re-awaiting the same builder re-executes it; fetchAllRows only re-applies
  // .range() between pages, which overwrites the previous page's window.
  const { data: businesses } = await fetchAllRows(() => q);
  if (!businesses?.length) return [];

  // Paginated: Supabase caps responses at 1000 rows. With a plain .limit(),
  // owners whose product/document rows fell past the cap were wrongly
  // classified as "no products"/"never taught" and got broadcasts they
  // shouldn't have.
  if (segment === 'no_products' || segment === 'never_taught') {
    if (segment === 'no_products') {
      const { data: withProducts } = await fetchAllRows(() =>
        sb.from('products').select('business_id').order('created_at', { ascending: true }));
      const hasProducts = new Set((withProducts || []).map(r => r.business_id));
      return businesses.filter(b => !hasProducts.has(b.id));
    }
    if (segment === 'never_taught') {
      const { data: withDocs } = await fetchAllRows(() =>
        sb.from('documents').select('business_id').order('created_at', { ascending: true }));
      const hasDocs = new Set((withDocs || []).map(r => r.business_id));
      return businesses.filter(b => !hasDocs.has(b.id));
    }
  }

  return businesses;
}

// Enrich businesses with last_message_at, product_count, document_count.
// One round-trip each, batched. Only needed for the recipient-picker preview.
export async function enrichRecipients(businesses) {
  if (!businesses.length) return [];
  const sb = supabase();
  const ids = businesses.map(b => b.id);

  // Most recent message per business — used as the real "last active" signal,
  // since updated_at on `businesses` only changes when the row itself is
  // updated and so understates activity for owners who just chat through the bot.
  // Recent window is fetched exhaustively (paginated past the 1000-row cap)
  // so the ACTIVE/IDLE flag is exact; the older "last message" lookup stays a
  // newest-first sample since it's display-only.
  // Chunked via fetchAllRowsForIds — a plain .in('business_id', ids) breaks
  // once `ids` gets into the hundreds (URL length), silently returning no
  // rows if the caller doesn't check `error`. See its doc comment.
  const activeWindowStart = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const idBatches = [];
  for (let i = 0; i < ids.length; i += 150) idBatches.push(ids.slice(i, i + 150));

  const [{ data: recentMsgs }, olderMsgsBatches, { data: prods }, { data: docs }] = await Promise.all([
    fetchAllRowsForIds(ids, batch => sb.from('messages').select('business_id, created_at')
      .in('business_id', batch).gte('created_at', activeWindowStart)
      .order('created_at', { ascending: false })),
    // Deliberately capped per batch, not fully paginated — this is a
    // newest-first display-only sample, not an exact count.
    Promise.all(idBatches.map(batch => sb.from('messages').select('business_id, created_at')
      .in('business_id', batch).lt('created_at', activeWindowStart)
      .order('created_at', { ascending: false }).limit(1000))),
    fetchAllRowsForIds(ids, batch => sb.from('products').select('business_id').in('business_id', batch).order('created_at', { ascending: true })),
    fetchAllRowsForIds(ids, batch => sb.from('documents').select('business_id').in('business_id', batch).order('created_at', { ascending: true })),
  ]);
  const olderMsgs = olderMsgsBatches.flatMap(r => r.data || []);

  const lastMsgByBiz = {};
  for (const m of [...(recentMsgs || []), ...(olderMsgs || [])]) {
    if (!lastMsgByBiz[m.business_id]) lastMsgByBiz[m.business_id] = m.created_at;
  }
  const prodByBiz = {}, docByBiz = {};
  for (const p of prods || []) prodByBiz[p.business_id] = (prodByBiz[p.business_id] || 0) + 1;
  for (const d of docs  || []) docByBiz[d.business_id]  = (docByBiz[d.business_id]  || 0) + 1;

  const now = Date.now();
  return businesses.map(b => {
    const lastMsg = lastMsgByBiz[b.id] || null;
    const lastActive = lastMsg || b.updated_at || b.created_at;
    const lastActiveMs = new Date(lastActive).getTime();
    return {
      id: b.id,
      name: b.name,
      owner_name: b.owner_name,
      telegram_bot_username: b.telegram_bot_username,
      shop_code: b.shop_code,
      last_active_at: lastActive,
      last_message_at: lastMsg,
      is_active_7d: (now - lastActiveMs) < ACTIVE_WINDOW_MS,
      opted_out: b.notification_prefs?.owner_nudges?.opted_out === true,
      product_count: prodByBiz[b.id] || 0,
      document_count: docByBiz[b.id] || 0,
    };
  });
}

/**
 * Send a broadcast message to a list of recipient businesses (already
 * resolved + opt-out filtered by the caller). Flood-safe, records an
 * outreach_sends row per recipient regardless of outcome, and persists an
 * opt-out on Telegram-blocked exactly like the original notify-owners loop.
 *
 * `source` identifies who's sending: { type: 'campaign', campaign_id } or
 * { type: 'rule', rule_id, rule_key }.
 *
 * Returns { sent, failed, blocked, aborted_flood_wait, failures, broadcast_id }.
 * `broadcast_id` tags every outreach_sends row this call writes, so a caller
 * can later ask "what happened after THIS specific send" (app opens, funnel
 * progress) without it blurring into other sends that share the same
 * source/campaign/rule.
 */
export async function sendBroadcast({ token, recipients, message, includeOpenButton = true, source }) {
  const sb = supabase();
  const broadcastId = randomUUID();
  const privacyUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/$/, '') + '/legal/privacy';
  const FOOTER = `\n\n— MiniMe · Reply STOP if you don't want these updates · Privacy: ${privacyUrl}`;
  const baseText = message.trim().slice(0, 4096 - FOOTER.length) + FOOTER;
  const miniAppUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  const replyMarkup = includeOpenButton && miniAppUrl
    ? { inline_keyboard: [[{ text: '📱 Open MiniMe', web_app: { url: miniAppUrl } }]] }
    : undefined;

  let sent = 0, failed = 0, blocked = 0;
  let abortedFloodWait = false;
  const failures = [];
  const breaker = floodBreaker(3);

  for (const b of recipients) {
    if (breaker.tripped) { abortedFloodWait = true; break; }
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    let status, telegramError = null;

    if (!chatId) {
      failed++; status = 'failed';
      await logSend(sb, { business_id: b.id, broadcast_id: broadcastId, source, status, telegram_error: 'no_chat_id', message_preview: baseText.slice(0, 200) });
      continue;
    }

    const greeting = b.owner_name ? `Hi ${b.owner_name.split(' ')[0]},\n\n` : '';
    const text = (greeting + baseText).slice(0, 4096);

    const r = await sendTelegramMessage(token, {
      chat_id: chatId, text, parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });

    if (r.retryAfterHit && !r.ok) breaker.hit429(); else breaker.okSend();

    if (r.ok) {
      sent++; status = 'sent';
    } else if (r.blocked) {
      // Owner blocked the shared bot (or deleted their account) — that's a
      // consent withdrawal. Persist an opt-out so no future broadcast,
      // rule-fire or campaign, targets them again.
      blocked++; status = 'blocked'; telegramError = r.description || null;
      failures.push({ business_id: b.id, code: r.status, desc: r.description?.slice(0, 80) });
      try {
        const { data: row } = await sb.from('businesses').select('notification_prefs').eq('id', b.id).single();
        const prefs = row?.notification_prefs || {};
        await sb.from('businesses').update({
          notification_prefs: {
            ...prefs,
            owner_nudges: { ...(prefs.owner_nudges || {}), opted_out: true, opted_out_reason: 'telegram_blocked' },
          },
        }).eq('id', b.id);
      } catch (e) { console.warn('[outreach] opt-out persist failed:', e.message); }
    } else {
      failed++; status = 'failed'; telegramError = r.description || null;
      failures.push({ business_id: b.id, code: r.status, desc: r.description?.slice(0, 80) });
    }

    await logSend(sb, { business_id: b.id, broadcast_id: broadcastId, source, status, telegram_error: telegramError, message_preview: text.slice(0, 200) });
    await sleep(50);
  }

  return { sent, failed, blocked, aborted_flood_wait: abortedFloodWait, failures, broadcast_id: broadcastId };
}

async function logSend(sb, { business_id, broadcast_id, source, status, telegram_error, message_preview }) {
  try {
    await sb.from('outreach_sends').insert({
      business_id,
      broadcast_id,
      source_type: source.type,
      rule_id: source.type === 'rule' ? source.rule_id : null,
      campaign_id: source.type === 'campaign' ? source.campaign_id : null,
      rule_key: source.type === 'rule' ? source.rule_key : null,
      status,
      telegram_error,
      message_preview,
    });
  } catch (e) {
    console.warn('[outreach] send-log insert failed:', e.message);
  }
}
