/**
 * GET /api/cron/followups — daily proactive follow-ups.
 *
 * Runs once a day (Vercel cron). For every active business it:
 *   1. Finds "cold leads": conversations with last inbound > N days ago that
 *      had a brain reply but no order or follow-through.
 *   2. Finds open jobs whose customer has been silent > 3 days.
 *   3. For each, runs the agent brain with a synthetic "follow up" trigger
 *      so MiniMe reaches out using its normal tools (it can choose to send a
 *      gentle nudge, share a portfolio, or do nothing).
 *
 * Idempotent — won't double-message: tracks a `last_followup_at` per
 * conversation in conversations.metadata.
 *
 * Auth: Vercel cron requests carry an Authorization header with CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { runBrain } from '../../../../lib/server/agentBrain';
import { tg } from '../../../../lib/server/telegramApi';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const COLD_DAYS = 4;          // open jobs / chats silent this long get a nudge
const FOLLOWUP_COOLDOWN_HRS = 72;  // don't nudge same convo more often than this
const MAX_PER_BUSINESS = 8;   // safety cap

export async function GET(request) {
  // Allow Vercel cron OR a manual call with the secret in a query param.
  const authed =
    isCronAuthorized(request);
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const sb = supabase();

  // Include both custom-bot businesses AND shared-mode businesses (onboarding_completed + shop_code)
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, telegram_bot_token_enc, telegram_bot_username, shop_code, onboarding_completed, brain_mode, panic_mode, notification_prefs, owner_telegram_id, owner_name, category, website, portfolio_url, instagram, facebook, tiktok, telegram_channel, whatsapp, address, business_hours')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)');

  const summary = [];
  for (const business of businesses || []) {
    if (business.panic_mode) continue;
    if (!business.brain_mode) continue;
    // Skip during quiet hours so we don't fire DMs at 3am
    const dnd = business.notification_prefs?.dnd;
    if (dnd?.enabled && isQuietNow(dnd)) continue;

    // Resolve token: custom bot token → platform agent token
    let token;
    if (business.telegram_bot_token_enc) {
      try { token = decrypt(business.telegram_bot_token_enc); } catch { continue; }
    } else {
      if (!AGENT_TOKEN) continue;
      token = AGENT_TOKEN;
    }

    const result = await runFollowupsForBusiness(sb, business, token);
    summary.push({ business: business.name, ...result });
  }

  return NextResponse.json({ ok: true, businesses_processed: summary.length, summary });
}

async function runFollowupsForBusiness(sb, business, token) {
  const cutoffISO = new Date(Date.now() - COLD_DAYS * 86400000).toISOString();
  const cooldownISO = new Date(Date.now() - FOLLOWUP_COOLDOWN_HRS * 3600000).toISOString();

  // ── 1. Cold open jobs ──
  const { data: jobs } = await sb.from('jobs')
    .select('id, title, customer_id, conversation_id, status, current_step, deadline, budget, currency, updated_at')
    .eq('business_id', business.id)
    .in('status', ['active', 'awaiting_approval', 'blocked'])
    .lt('updated_at', cutoffISO)
    .limit(MAX_PER_BUSINESS);

  // ── 2. Cold conversations with no open job (lead went silent) ──
  const { data: convs } = await sb.from('conversations')
    .select('id, customer_id, last_message_at, metadata')
    .eq('business_id', business.id)
    .eq('status', 'active')
    .lt('last_message_at', cutoffISO)
    .limit(MAX_PER_BUSINESS);

  const targets = [];

  for (const j of jobs || []) {
    if (!j.conversation_id || !j.customer_id) continue;
    targets.push({ kind: 'job', conv_id: j.conversation_id, customer_id: j.customer_id, job });
  }

  for (const c of convs || []) {
    const lastFollowupAt = c.metadata?.last_followup_at;
    if (lastFollowupAt && lastFollowupAt > cooldownISO) continue;
    targets.push({ kind: 'lead', conv_id: c.id, customer_id: c.customer_id });
  }

  // De-dup by conv_id, cap total
  const seen = new Set();
  const unique = targets.filter(t => {
    if (seen.has(t.conv_id)) return false;
    seen.add(t.conv_id);
    return true;
  }).slice(0, MAX_PER_BUSINESS);

  let dispatched = 0;
  for (const t of unique) {
    const { data: conv } = await sb.from('conversations').select('id, customer_id, metadata').eq('id', t.conv_id).single();
    if (!conv) continue;
    const lastFollowupAt = conv.metadata?.last_followup_at;
    if (lastFollowupAt && lastFollowupAt > cooldownISO) continue;

    const { data: customer } = await sb.from('customers').select('*').eq('id', t.customer_id).single();
    if (!customer?.telegram_id) continue;

    const triggerText = t.kind === 'job'
      ? `[SYSTEM FOLLOW-UP] This client has been silent for ${COLD_DAYS}+ days on an active job. Send a warm, low-pressure nudge — ask if they have any updates or questions, or share a relevant portfolio piece. Do NOT pretend they sent you a message; you are the one re-opening the conversation.`
      : `[SYSTEM FOLLOW-UP] This lead has gone silent for ${COLD_DAYS}+ days after an earlier conversation. Send ONE short, warm message that reopens the door — reference what they were interested in, share a relevant link or sample, and ask if they're still considering. No pressure. Do NOT pretend they sent you a message; you are the one re-opening the conversation.`;

    try {
      await runBrain({
        token,
        business,
        customer,
        conversation: conv,
        chatId: customer.telegram_id,
        messageId: null,
        inboundText: triggerText,
      });
      const newMeta = { ...(conv.metadata || {}), last_followup_at: new Date().toISOString() };
      await sb.from('conversations').update({ metadata: newMeta }).eq('id', conv.id);
      dispatched++;
    } catch (e) {
      console.warn('followup failed for conv', conv.id, e.message);
    }
  }

  return { cold_jobs: jobs?.length || 0, cold_convs: convs?.length || 0, dispatched };
}

function isQuietNow(dnd) {
  const start = Number(dnd.start_hour);
  const end = Number(dnd.end_hour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const addisHour = (new Date().getUTCHours() + 3) % 24;
  if (start < end) return addisHour >= start && addisHour < end;
  return addisHour >= start || addisHour < end;
}
