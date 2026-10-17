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
 *   incomplete_catalog — has products, but ≥1 is missing a price or a photo
 *                    (≥2 days since signup). Those products silently degrade
 *                    to "let me check with the owner" instead of an instant
 *                    answer, so this is worth flagging even for an otherwise
 *                    active catalog. Sent at most 3 times, 21 days apart.
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
import { DAY_MS, appUrl, nudgeContent, pickNudgeType, isCooledDown, plainText } from '../../../../lib/server/ownerNudges.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;


function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


async function sendNudge(token, chatId, content) {
  const url = appUrl();
  const keyboard = [...(content.buttons || []), ...(url ? [[{ text: '📱 Open MiniMe', web_app: { url } }]] : [])];
  const send = markdown => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: markdown ? content.text : plainText(content.text),
      ...(markdown ? { parse_mode: 'Markdown' } : {}),
      disable_web_page_preview: true,
      reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const r = await send(true);
  if (r.status !== 400) return r;
  // A formatting slip must cost the bold, not the message: resend as plain
  // text instead of failing the same owners every day.
  const j = await r.clone().json().catch(() => ({}));
  if (!/can't parse entities/i.test(j?.description || '')) return r;
  console.warn(`[cron/owner-nudges] Markdown rejected for ${chatId}, resending as plain text: ${j.description}`);
  return send(false);
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
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, created_at, updated_at, notification_prefs, shop_code, telegram_bot_username, subscription_status, trial_started_at, trial_ends_at, category')
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
    sb.from('products').select('business_id, name, price, image_url, is_active').in('business_id', ids).limit(20000),
    sb.from('documents').select('business_id').in('business_id', ids).limit(20000),
    sb.from('customers').select('business_id').in('business_id', ids).limit(20000),
    sb.from('messages').select('business_id, customer_id, direction, is_ai_generated')
      .in('business_id', ids).gte('created_at', weekAgo).limit(20000),
  ]);
  const productByBiz = {}, docByBiz = {}, customerByBiz = {}, aiMsgsByBiz = {}, weekCustByBiz = {};
  // Products missing a price (NULL = "price on request", not 0 — see
  // teaching.js) or a photo (image_url NULL) per business, active listings only.
  const incompleteByBiz = {};
  for (const p of prods || []) {
    productByBiz[p.business_id] = (productByBiz[p.business_id] || 0) + 1;
    if (p.is_active === false) continue;
    const missingPrice = p.price === null || p.price === undefined;
    const missingPhoto = !p.image_url;
    if (!missingPrice && !missingPhoto) continue;
    const bucket = incompleteByBiz[p.business_id] || (incompleteByBiz[p.business_id] = { missingPrice: 0, missingPhoto: 0, examples: [] });
    if (missingPrice) bucket.missingPrice++;
    if (missingPhoto) bucket.missingPhoto++;
    if (bucket.examples.length < 3 && p.name) bucket.examples.push(p.name);
  }
  for (const d of docs  || []) docByBiz[d.business_id]     = (docByBiz[d.business_id]     || 0) + 1;
  for (const c of custs || []) customerByBiz[c.business_id] = (customerByBiz[c.business_id] || 0) + 1;

  // ── Monday demand digest data (EAT week starts fresh Monday morning) ──────
  // Per-business Market traction (top product by views/clicks, last 7d) and
  // unmet-demand queries grouped by category — fetched ONCE per run, only on
  // Mondays, so the daily cron cost doesn't change the other six days.
  const isMondayEAT = new Date(now + 3 * 3600 * 1000).getUTCDay() === 1;
  const tractionByBiz = {};   // business_id → { name, views, clicks }
  const unmetByCategory = {}; // category → [{ query, searches }]
  if (isMondayEAT) {
    try {
      const [{ data: mkt }, { unmetDemand }] = await Promise.all([
        sb.from('market_events')
          .select('business_id, product_id, event_type')
          .in('event_type', ['view_product', 'click_chat'])
          .not('product_id', 'is', null)
          .gte('created_at', weekAgo)
          .limit(20000),
        import('../../../../lib/server/demand'),
      ]);
      // Top product per business by views+clicks
      const perBizProd = {}; // biz → { productId → { views, clicks } }
      for (const e of mkt || []) {
        if (!e.business_id) continue;
        const bp = perBizProd[e.business_id] || (perBizProd[e.business_id] = {});
        const s = bp[e.product_id] || (bp[e.product_id] = { views: 0, clicks: 0 });
        if (e.event_type === 'click_chat') s.clicks++; else s.views++;
      }
      const topProdIds = [];
      const topPerBiz = {};
      for (const [bizId, bp] of Object.entries(perBizProd)) {
        const [pid, s] = Object.entries(bp).sort((a, b) => (b[1].clicks - a[1].clicks) || (b[1].views - a[1].views))[0];
        topPerBiz[bizId] = { pid, ...s };
        topProdIds.push(pid);
      }
      if (topProdIds.length) {
        const { data: prodNames } = await sb.from('products').select('id, name').in('id', topProdIds);
        const nameOf = Object.fromEntries((prodNames || []).map(p => [p.id, p.name]));
        for (const [bizId, t] of Object.entries(topPerBiz)) {
          if (nameOf[t.pid]) tractionByBiz[bizId] = { name: nameOf[t.pid], views: t.views, clicks: t.clicks };
        }
      }
      // Unmet demand → category buckets (last 14d keeps it fresh)
      const unmet = await unmetDemand({ days: 14, limit: 50 });
      for (const u of unmet) {
        if (!u.category || u.searches < 2) continue; // ≥2 searches = real signal
        (unmetByCategory[u.category] = unmetByCategory[u.category] || []).push({ query: u.query, searches: u.searches + u.waiting });
      }
    } catch (e) {
      console.warn('[cron/owner-nudges] demand digest data failed:', e.message);
    }
  }
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
    const daysUntilTrialEnd = b.trial_ends_at ? (new Date(b.trial_ends_at).getTime() - now) / DAY_MS : null;
    // Stash week stats on the business so nudgeContent can render the recap.
    b._stats = {
      ai_messages_week: aiMsgsByBiz[b.id] || 0,
      customers_week: weekCustByBiz[b.id]?.size || 0,
    };
    // Monday demand digest: own Market traction + up to 2 unmet-demand queries
    // in this business's category. Both empty → no digest, no nudge.
    if (isMondayEAT) {
      const top = tractionByBiz[b.id] || null;
      const cat = (b.category || '').toLowerCase();
      const opportunities = (unmetByCategory[cat] || []).slice(0, 2);
      if (top || opportunities.length) b._demand = { top, opportunities };
    }
    if (incompleteByBiz[b.id]) b._incomplete = incompleteByBiz[b.id];
    const type = pickNudgeType({
      business: b,
      productCount: productByBiz[b.id] || 0,
      documentCount: docByBiz[b.id] || 0,
      customerCount: customerByBiz[b.id] || 0,
      aiMessagesWeek: b._stats.ai_messages_week,
      daysSinceSignup,
      daysSinceActive,
      daysUntilTrialEnd,
      hasDemandDigest: !!b._demand,
      hasIncompleteCatalog: !!b._incomplete,
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
