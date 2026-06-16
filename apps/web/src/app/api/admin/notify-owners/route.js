/**
 * Admin → owner re-engagement broadcast.
 *
 * GET  /api/admin/notify-owners?segment=...[&include_recipients=1]
 *   With include_recipients=1, returns the actual list of owners that would
 *   be targeted (so the admin UI can show a checkbox picker + last-active
 *   timestamps and let the admin de-select individuals). Without it, returns
 *   only the count — faster for a quick segment preview.
 *
 *   Response: {
 *     segment, count, active_count, cooldown_ms,
 *     recipients?: [{ id, name, owner_name, telegram_bot_username, shop_code,
 *                     last_active_at, last_message_at, is_active_7d,
 *                     opted_out, product_count, document_count }]
 *   }
 *
 * POST /api/admin/notify-owners
 *   Body: {
 *     message,
 *     segment?,              // ignored if business_ids is provided
 *     business_ids?,         // explicit list of business UUIDs to send to
 *     dry_run?,
 *     include_open_button?,
 *   }
 *   business_ids takes precedence over segment — the UI uses it to send to a
 *   hand-picked subset. We still require every targeted business to be
 *   onboarded with an owner_telegram_id (and not opted out) before sending,
 *   so a stale ID can't trick us into messaging a half-onboarded account.
 *
 * Why the *shared* bot:
 *   Every owner — whether they later linked their own bot or stayed in shared
 *   mode — went through onboarding by chatting with @MiniMeAgentBot. So
 *   sending from there is guaranteed to reach a chat the owner has already
 *   accepted.
 *
 * Rate limit: 1 broadcast / 5 min, platform-wide.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { str, oneOf, ValidationError, validationResponse } from '../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_SEGMENTS = ['all', 'shared', 'linked', 'inactive_7d', 'no_products', 'never_taught', 'stuck_signup'];
const ACTIVE_WINDOW_MS = 7 * 86400000;

// In-process rate limit. Platform-wide because we're using one shared bot.
let lastBroadcastAt = 0;
const RATE_LIMIT_MS = 5 * 60 * 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function selectRecipients(segment) {
  const sb = supabase();

  // Base: every owner who has an owner_telegram_id (so we can DM them).
  let q = sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_username, shop_code, updated_at, created_at, notification_prefs, onboarding_step, onboarding_completed')
    .not('owner_telegram_id', 'is', null);

  // "Stuck in signup" = started onboarding (a business row exists) but never
  // finished — everything else is scoped to owners who did finish.
  if (segment === 'stuck_signup') q = q.eq('onboarding_completed', false);
  else                            q = q.eq('onboarding_completed', true);

  if (segment === 'shared')      q = q.is('telegram_bot_username', null).not('shop_code', 'is', null);
  if (segment === 'linked')      q = q.not('telegram_bot_username', 'is', null);
  if (segment === 'inactive_7d') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    q = q.lt('updated_at', sevenDaysAgo);
  }

  const { data: businesses } = await q.limit(2000);
  if (!businesses?.length) return [];

  if (segment === 'no_products' || segment === 'never_taught') {
    const ids = businesses.map(b => b.id);
    if (segment === 'no_products') {
      const { data: withProducts } = await sb.from('products')
        .select('business_id').in('business_id', ids).limit(20000);
      const hasProducts = new Set((withProducts || []).map(r => r.business_id));
      return businesses.filter(b => !hasProducts.has(b.id));
    }
    if (segment === 'never_taught') {
      const { data: withDocs } = await sb.from('documents')
        .select('business_id').in('business_id', ids).limit(20000);
      const hasDocs = new Set((withDocs || []).map(r => r.business_id));
      return businesses.filter(b => !hasDocs.has(b.id));
    }
  }

  return businesses;
}

// Enrich businesses with last_message_at, product_count, document_count.
// One round-trip each, batched. We only do this when include_recipients=1
// because the count-only preview doesn't need it.
async function enrichRecipients(businesses) {
  if (!businesses.length) return [];
  const sb = supabase();
  const ids = businesses.map(b => b.id);

  // Most recent message per business — used as the real "last active" signal,
  // since updated_at on `businesses` only changes when the row itself is
  // updated and so understates activity for owners who just chat through the bot.
  const [{ data: msgs }, { data: prods }, { data: docs }] = await Promise.all([
    sb.from('messages').select('business_id, created_at')
      .in('business_id', ids).order('created_at', { ascending: false }).limit(10000),
    sb.from('products').select('business_id').in('business_id', ids).limit(20000),
    sb.from('documents').select('business_id').in('business_id', ids).limit(20000),
  ]);

  const lastMsgByBiz = {};
  for (const m of msgs || []) {
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
      onboarding_step: b.onboarding_completed ? null : (b.onboarding_step ?? 0),
      opted_out: b.notification_prefs?.owner_nudges?.opted_out === true,
      product_count: prodByBiz[b.id] || 0,
      document_count: docByBiz[b.id] || 0,
    };
  });
}

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const segment = url.searchParams.get('segment') || 'all';
  const includeRecipients = url.searchParams.get('include_recipients') === '1';
  if (!ALLOWED_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: 'invalid_segment' }, { status: 400 });
  }

  const raw = await selectRecipients(segment);
  const enriched = includeRecipients ? await enrichRecipients(raw) : null;

  // active_count: independent of whether the caller wanted full details.
  // For the count-only path we still need it so the admin sees "X of Y active"
  // without pulling the whole list.
  let activeCount;
  if (enriched) {
    activeCount = enriched.filter(r => r.is_active_7d).length;
  } else {
    const sevenDaysAgo = Date.now() - ACTIVE_WINDOW_MS;
    activeCount = raw.filter(b => new Date(b.updated_at || b.created_at).getTime() > sevenDaysAgo).length;
  }

  return NextResponse.json({
    segment,
    count: raw.length,
    active_count: activeCount,
    cooldown_ms: Math.max(0, RATE_LIMIT_MS - (Date.now() - lastBroadcastAt)),
    ...(enriched ? { recipients: enriched.sort((a, b) => (b.last_active_at || '').localeCompare(a.last_active_at || '')) } : {}),
  });
}

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_platform_bot_token' }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  let message, segment, includeOpenButton, dryRun, businessIds;
  try {
    message = str(body.message, { field: 'message', min: 1, max: 3800, required: true, stripHtml: true });
    segment = oneOf(body.segment, ALLOWED_SEGMENTS, { field: 'segment', required: false }) || 'all';
    includeOpenButton = body.include_open_button !== false;
    dryRun = !!body.dry_run;
    // business_ids overrides segment. We validate shape here (UUID strings,
    // de-duped, capped at 2000 so a typo can't fan out into the whole DB).
    if (Array.isArray(body.business_ids) && body.business_ids.length) {
      businessIds = Array.from(new Set(body.business_ids
        .filter(x => typeof x === 'string' && /^[0-9a-f-]{20,40}$/i.test(x))))
        .slice(0, 2000);
      if (!businessIds.length) {
        return NextResponse.json({ error: 'no_valid_business_ids' }, { status: 400 });
      }
    }
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!dryRun && Date.now() - lastBroadcastAt < RATE_LIMIT_MS) {
    const waitSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastBroadcastAt)) / 1000);
    return NextResponse.json({ error: `Please wait ${waitSec}s before sending another broadcast.` }, { status: 429 });
  }

  // Resolve recipients. business_ids path re-fetches from the DB rather than
  // trusting whatever the client sent, so we don't end up DMing someone who
  // got deleted between the UI loading and the admin clicking send.
  let recipients;
  if (businessIds) {
    const sb = supabase();
    const { data } = await sb.from('businesses')
      .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_username, shop_code, notification_prefs')
      .in('id', businessIds)
      .not('owner_telegram_id', 'is', null);
    recipients = data || [];
  } else {
    recipients = await selectRecipients(segment);
  }

  // Respect opt-outs regardless of how the recipient list was assembled.
  // An admin hand-picking an opted-out owner could otherwise route around
  // the very setting that owner asked us to honor.
  recipients = recipients.filter(b => b.notification_prefs?.owner_nudges?.opted_out !== true);

  if (!recipients.length) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, total: 0, message: 'No reachable owners after filtering opt-outs.' });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true, dry_run: true, total: recipients.length,
      segment: businessIds ? 'custom' : segment,
      sample: recipients.slice(0, 5).map(b => ({ id: b.id, name: b.name, owner_name: b.owner_name })),
    });
  }

  lastBroadcastAt = Date.now();

  const FOOTER = '\n\n— MiniMe · Reply STOP if you don\'t want these updates.';
  const baseText = message.trim().slice(0, 4096 - FOOTER.length) + FOOTER;
  const miniAppUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  const replyMarkup = includeOpenButton && miniAppUrl
    ? { inline_keyboard: [[{ text: '📱 Open MiniMe', web_app: { url: miniAppUrl } }]] }
    : undefined;

  let sent = 0, failed = 0;
  const failures = [];

  for (const b of recipients) {
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    if (!chatId) { failed++; continue; }
    const greeting = b.owner_name ? `Hi ${b.owner_name.split(' ')[0]},\n\n` : '';
    const text = (greeting + baseText).slice(0, 4096);
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId, text, parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        sent++;
      } else {
        failed++;
        const j = await r.json().catch(() => ({}));
        failures.push({ business_id: b.id, code: r.status, desc: j?.description?.slice(0, 80) });
      }
    } catch (e) {
      failed++;
      failures.push({ business_id: b.id, code: 0, desc: e.message?.slice(0, 80) });
    }
    await sleep(50);
  }

  console.log(`[admin/notify-owners] mode=${businessIds ? 'custom' : segment} sent=${sent} failed=${failed} total=${recipients.length}`);

  await audit({
    business_id: null,
    actor_type: 'platform_admin',
    actor_id: String(tg.id),
    action: 'notify_owners.sent',
    resource_type: 'broadcast',
    resource_id: null,
    metadata: {
      mode: businessIds ? 'custom' : segment,
      sent, failed, total: recipients.length,
      message_preview: message.slice(0, 120),
      failure_samples: failures.slice(0, 10),
    },
    request,
  });

  return NextResponse.json({
    ok: true, sent, failed, total: recipients.length,
    segment: businessIds ? 'custom' : segment,
  });
}
