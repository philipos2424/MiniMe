/**
 * Daily owner re-engagement nudges.
 *
 * Sends targeted, throttled DMs from @MiniMeAgentBot to owners who finished
 * onboarding but stalled or went quiet. The goal is to convert dormant signups
 * into active users *without* turning into spam — so every nudge type has its
 * own cooldown, and there is a hard global cap on how often we'll ping a
 * single owner regardless of which type fires.
 *
 * Three nudge types, evaluated in priority order. Only the first matching one
 * fires for any given owner on any given run.
 *
 *   never_taught   — onboarding_completed && (≥3 days since signup) && 0 docs && 0 products
 *                    "Here's how to use MiniMe" walkthrough. Sent at most twice,
 *                    21 days apart, then we give up so we're not the kind of
 *                    product that nags forever.
 *
 *   no_products    — onboarding_completed && (≥2 days since signup) && 0 products
 *                    Shorter "add 3–5 products" prompt. Sent at most twice,
 *                    21 days apart.
 *
 *   inactive_14d   — onboarding_completed && updated_at <14 days ago && has products
 *                    "We miss you" + the deep link back to the dashboard. At most
 *                    once every 21 days, max 3 lifetime.
 *
 * Global cap: a single owner gets at most ONE nudge of any kind per 7 days,
 * regardless of which type would fire — because the *experience* of getting
 * pinged matters more than the taxonomy.
 *
 * Opt-out: notification_prefs.owner_nudges.opted_out === true skips entirely.
 * The shared-bot webhook sets this when an owner replies STOP (see
 * agent-bot/webhook/route.js).
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Schedule: registered in vercel.json (08:00 UTC daily, after morning-briefing).
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY_MS = 86_400_000;

// Cooldowns, per nudge type and globally. Tweak here, not inline.
const GLOBAL_COOLDOWN_MS  = 7 * DAY_MS;
const PER_TYPE_COOLDOWN_MS = 21 * DAY_MS;
const MAX_PER_TYPE = { never_taught: 2, no_products: 2, inactive_14d: 3, no_first_customer: 2, trial_day10_value: 1 };
// Time-critical nudges that may fire even inside the 7-day global cooldown —
// the trial recap lands near the end of the trial and should not be blocked by
// an earlier setup nudge.
const GLOBAL_COOLDOWN_EXEMPT = new Set(['trial_day10_value']);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app')
    .trim().replace(/\/$/, '');
}

function nudgeContent(type, business) {
  const first = (business.owner_name || '').split(' ')[0] || 'there';
  const url = appUrl();
  const stopHint = '\n\n_Tap "📱 Open MiniMe" below — or reply STOP to silence these reminders._';

  if (type === 'never_taught') {
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `Your *${business.name}* MiniMe assistant is set up — but it doesn't know your business yet. ` +
        `Until you teach it, it can only say "let me check with the owner." That's me bugging you 😅\n\n` +
        `*Two minutes to get it answering on its own:*\n` +
        `1. Open MiniMe → tap *Teach*\n` +
        `2. Paste your top 5 products or send a photo of your price list\n` +
        `3. Add your hours, location, and the 3 questions you get most\n\n` +
        `That's it. It'll handle the routine stuff and forward only the messages that actually need you.` +
        stopHint,
    };
  }

  if (type === 'no_products') {
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `Quick nudge — your *${business.name}* shop is live but your catalog is still empty.\n\n` +
        `Adding even *3 products* lets MiniMe quote prices, show photos, and take orders without waking you up. ` +
        `Open the app → *Teach* → paste a list or send a photo. Two minutes, max.` +
        stopHint,
    };
  }

  if (type === 'inactive_14d') {
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `It's been a couple of weeks since you checked in on *${business.name}* in MiniMe. ` +
        `Worth a peek — new messages, new customers, and any drafts waiting for your approval are all on the home screen.\n\n` +
        `If you've changed prices or added new products since, a quick *Teach* keeps the replies accurate.` +
        stopHint,
    };
  }

  if (type === 'no_first_customer') {
    const shopLink = business.telegram_bot_username
      ? `https://t.me/${business.telegram_bot_username}`
      : business.shop_code
        ? `https://t.me/MiniMeAgentBot?start=shop_${business.shop_code}`
        : url;
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `*${business.name}* is live — but no customer has messaged it yet. The fix is one share away.\n\n` +
        `Post this link in ONE place where your customers already are (a Telegram group, your status, your Instagram bio):\n\n` +
        `${shopLink}\n\n` +
        `Ready-made caption you can copy:\n` +
        `_"You can now order from ${business.name} on Telegram — ask anything, get an instant answer 👆"_\n\n` +
        `The first time MiniMe answers a real customer for you, you'll get it.` +
        stopHint,
    };
  }

  if (type === 'trial_day10_value') {
    const s = business._stats || {};
    const replied = s.ai_messages_week || 0;
    const customers = s.customers_week || 0;
    return {
      text:
        `Hi ${first} 👋\n\n` +
        `Quick check-in — 10 days into your *${business.name}* trial:\n\n` +
        `🤖 *${replied}* message${replied === 1 ? '' : 's'} answered by MiniMe\n` +
        `👤 *${customers}* customer${customers === 1 ? '' : 's'} handled\n\n` +
        `That's time you didn't spend glued to your phone. Your trial ends in a few days — keep it running for *2,500 birr/month* (Telebirr, CBE, or card).\n\n` +
        `Open MiniMe → *Settings → Billing*. Takes a minute.` +
        stopHint,
    };
  }

  return null;
}

// Decide which (if any) nudge type applies to a given business. Returns the
// nudge key or null. Higher-priority types come first; the first match wins.
function pickNudgeType({ business, productCount, documentCount, customerCount, aiMessagesWeek, daysSinceSignup, daysSinceActive, daysSinceTrialStart }) {
  const noProducts = productCount === 0;
  const noTeaching = documentCount === 0 && productCount === 0;

  // Day-10 trial value recap — time-critical (14-day trial), highest priority.
  // Only fires when there's real value to show; an empty recap would undercut
  // the pitch.
  if (
    business.subscription_status === 'trial' &&
    daysSinceTrialStart != null && daysSinceTrialStart >= 9.5 && daysSinceTrialStart <= 11.5 &&
    aiMessagesWeek >= 3
  ) return 'trial_day10_value';

  // Live but zero customers ever — the activation moment that actually matters
  // is the first real customer message, not the Go Live tap. Push one share.
  if (customerCount === 0 && daysSinceSignup >= 1 && daysSinceSignup <= 14) return 'no_first_customer';

  if (noTeaching && daysSinceSignup >= 3) return 'never_taught';
  if (noProducts && daysSinceSignup >= 2) return 'no_products';
  if (productCount > 0 && daysSinceActive >= 14) return 'inactive_14d';
  return null;
}

function isCooledDown(history, type, now) {
  const all = history?.sent || {};
  const global = history?.last_sent_at ? new Date(history.last_sent_at).getTime() : 0;
  if (global && now - global < GLOBAL_COOLDOWN_MS && !GLOBAL_COOLDOWN_EXEMPT.has(type)) return false;
  const t = all[type];
  if (!t) return true;
  if ((t.count || 0) >= (MAX_PER_TYPE[type] || 2)) return false;
  const last = t.last_at ? new Date(t.last_at).getTime() : 0;
  return now - last >= PER_TYPE_COOLDOWN_MS;
}

async function sendNudge(token, chatId, content) {
  const url = appUrl();
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: content.text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: url ? { inline_keyboard: [[{ text: '📱 Open MiniMe', web_app: { url } }]] } : undefined,
    }),
    signal: AbortSignal.timeout(8000),
  });
  return r;
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const now = Date.now();
  const sb = supabase();

  // Onboarded owners we could reach. Limit is high enough we won't truncate
  // anyone real for a long time, low enough to keep this cron well under its
  // 300s budget even if we sleep 50ms per send.
  const { data: businesses, error } = await sb
    .from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, created_at, updated_at, notification_prefs, shop_code, telegram_bot_username, subscription_status, trial_started_at')
    .eq('onboarding_completed', true)
    .not('owner_telegram_id', 'is', null)
    .limit(2000);

  if (error) {
    console.error('[cron/owner-nudges] businesses query failed:', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!businesses?.length) return NextResponse.json({ ok: true, eligible: 0, sent: 0, skipped: 0 });

  // Batch-fetch product/document/customer counts + this week's AI messages so
  // we don't N+1 the DB.
  const ids = businesses.map(b => b.id);
  const weekAgo = new Date(now - 7 * DAY_MS).toISOString();
  const [{ data: prods }, { data: docs }, { data: custs }, { data: msgs }] = await Promise.all([
    sb.from('products').select('business_id').in('business_id', ids).limit(20000),
    sb.from('documents').select('business_id').in('business_id', ids).limit(20000),
    sb.from('customers').select('business_id').in('business_id', ids).limit(20000),
    sb.from('messages').select('business_id, customer_id, direction, is_ai_generated')
      .in('business_id', ids).gte('created_at', weekAgo).limit(20000),
  ]);
  const productByBiz = {}, docByBiz = {}, customerByBiz = {}, aiMsgsByBiz = {}, weekCustByBiz = {};
  for (const p of prods || []) productByBiz[p.business_id] = (productByBiz[p.business_id] || 0) + 1;
  for (const d of docs  || []) docByBiz[d.business_id]     = (docByBiz[d.business_id]     || 0) + 1;
  for (const c of custs || []) customerByBiz[c.business_id] = (customerByBiz[c.business_id] || 0) + 1;
  for (const m of msgs || []) {
    if (m.direction === 'outbound' && m.is_ai_generated) {
      aiMsgsByBiz[m.business_id] = (aiMsgsByBiz[m.business_id] || 0) + 1;
    }
    if (m.customer_id) {
      (weekCustByBiz[m.business_id] = weekCustByBiz[m.business_id] || new Set()).add(m.customer_id);
    }
  }

  const summary = { eligible: 0, sent: 0, failed: 0, skipped_optout: 0, skipped_cooldown: 0, skipped_no_match: 0, by_type: {}, dry_run: dryRun };

  for (const b of businesses) {
    const history = b.notification_prefs?.owner_nudges || {};
    if (history.opted_out === true) { summary.skipped_optout++; continue; }

    const daysSinceSignup = (now - new Date(b.created_at).getTime()) / DAY_MS;
    const daysSinceActive = (now - new Date(b.updated_at || b.created_at).getTime()) / DAY_MS;
    const daysSinceTrialStart = b.trial_started_at ? (now - new Date(b.trial_started_at).getTime()) / DAY_MS : null;
    // Stash week stats on the business so nudgeContent can render the recap.
    b._stats = {
      ai_messages_week: aiMsgsByBiz[b.id] || 0,
      customers_week: weekCustByBiz[b.id]?.size || 0,
    };
    const type = pickNudgeType({
      business: b,
      productCount: productByBiz[b.id] || 0,
      documentCount: docByBiz[b.id] || 0,
      customerCount: customerByBiz[b.id] || 0,
      aiMessagesWeek: b._stats.ai_messages_week,
      daysSinceSignup,
      daysSinceActive,
      daysSinceTrialStart,
    });
    if (!type) { summary.skipped_no_match++; continue; }
    if (!isCooledDown(history, type, now)) { summary.skipped_cooldown++; continue; }

    summary.eligible++;
    summary.by_type[type] = (summary.by_type[type] || 0) + 1;
    if (dryRun) continue;

    const content = nudgeContent(type, b);
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    try {
      const r = await sendNudge(token, chatId, content);
      if (r.ok) {
        summary.sent++;
        const next = {
          ...history,
          last_sent_at: new Date(now).toISOString(),
          sent: {
            ...(history.sent || {}),
            [type]: {
              last_at: new Date(now).toISOString(),
              count: ((history.sent?.[type]?.count) || 0) + 1,
            },
          },
        };
        // Best-effort: a write failure must not stop us from nudging the next owner.
        await sb.from('businesses')
          .update({ notification_prefs: { ...(b.notification_prefs || {}), owner_nudges: next } })
          .eq('id', b.id)
          .then(() => {}, e => console.warn(`[cron/owner-nudges] history write failed for ${b.id}:`, e?.message));
      } else {
        summary.failed++;
        const j = await r.json().catch(() => ({}));
        console.warn(`[cron/owner-nudges] send failed for ${b.id} (${type}): ${r.status} ${j?.description || ''}`);
        // If Telegram says the owner blocked the bot, persist that so we stop
        // burning sends on a dead chat. 403 = bot blocked or chat not found.
        if (r.status === 403) {
          const next = { ...history, opted_out: true, opted_out_reason: 'telegram_403', opted_out_at: new Date(now).toISOString() };
          await sb.from('businesses')
            .update({ notification_prefs: { ...(b.notification_prefs || {}), owner_nudges: next } })
            .eq('id', b.id).then(() => {}, () => {});
        }
      }
    } catch (e) {
      summary.failed++;
      console.warn(`[cron/owner-nudges] send error for ${b.id}:`, e.message);
    }
    // Stay safely under Telegram's 30/sec bot limit.
    await sleep(60);
  }

  console.log('[cron/owner-nudges]', JSON.stringify(summary));

  if (!dryRun && (summary.sent || summary.failed)) {
    await audit({
      business_id: null,
      actor_type: 'system',
      actor_id: 'cron',
      action: 'owner_nudges.run',
      resource_type: 'cron',
      resource_id: null,
      metadata: summary,
      request,
    });
  }

  return NextResponse.json({ ok: true, ...summary });
}
