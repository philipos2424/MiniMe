/**
 * Admin → owner re-engagement broadcast.
 *
 * GET  /api/admin/notify-owners?segment=...
 *   Returns { count } — how many owners would receive the message for the
 *   selected segment. Use for pre-send confirmation.
 *
 * POST /api/admin/notify-owners
 *   Body: { message, segment?, dry_run?, include_open_button? }
 *   Sends the message from the shared @MiniMeAgentBot to every onboarded
 *   owner in the selected segment. Throttled at ~20/sec to respect Telegram
 *   limits. Returns { ok, sent, failed, total }.
 *
 * Why the *shared* bot:
 *   Every owner — whether they later linked their own bot or stayed in shared
 *   mode — went through onboarding by chatting with @MiniMeAgentBot. So
 *   sending from there is guaranteed to reach a chat the owner has already
 *   accepted. Using each owner's own linked bot would mean N tokens to decrypt
 *   and N bots to send from, with no upside for a platform-level announcement.
 *
 * Segments:
 *   all              — every onboarded owner
 *   shared           — shared-mode (uses @MiniMeAgentBot for their customers)
 *   linked           — has their own custom Telegram bot
 *   inactive_7d      — onboarded but not active in the last 7 days
 *   no_products      — onboarded but catalog is empty (needs /learn)
 *   never_taught     — never ran /learn or uploaded a document
 *
 * Rate limit: 1 broadcast / 5 min, platform-wide (Telegram is the bottleneck).
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

const ALLOWED_SEGMENTS = ['all', 'shared', 'linked', 'inactive_7d', 'no_products', 'never_taught'];

// In-process rate limit. Platform-wide because we're using one shared bot.
let lastBroadcastAt = 0;
const RATE_LIMIT_MS = 5 * 60 * 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function selectRecipients(segment) {
  const sb = supabase();

  // Base: every onboarded owner who has an owner_telegram_id (so we can DM them).
  let q = sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_username, shop_code, updated_at, created_at')
    .eq('onboarding_completed', true)
    .not('owner_telegram_id', 'is', null);

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
      // Keep only businesses with zero rows in `products`.
      const { data: withProducts } = await sb.from('products')
        .select('business_id').in('business_id', ids).limit(20000);
      const hasProducts = new Set((withProducts || []).map(r => r.business_id));
      return businesses.filter(b => !hasProducts.has(b.id));
    }
    if (segment === 'never_taught') {
      // Keep only businesses with zero documents (any source).
      const { data: withDocs } = await sb.from('documents')
        .select('business_id').in('business_id', ids).limit(20000);
      const hasDocs = new Set((withDocs || []).map(r => r.business_id));
      return businesses.filter(b => !hasDocs.has(b.id));
    }
  }

  return businesses;
}

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const segment = new URL(request.url).searchParams.get('segment') || 'all';
  if (!ALLOWED_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: 'invalid_segment' }, { status: 400 });
  }
  const recipients = await selectRecipients(segment);
  return NextResponse.json({
    count: recipients.length,
    segment,
    cooldown_ms: Math.max(0, RATE_LIMIT_MS - (Date.now() - lastBroadcastAt)),
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
  let message, segment, includeOpenButton, dryRun;
  try {
    // Telegram caps a sendMessage at 4096 chars. Leave room for personalisation.
    message = str(body.message, { field: 'message', min: 1, max: 3800, required: true, stripHtml: true });
    segment = oneOf(body.segment, ALLOWED_SEGMENTS, { field: 'segment', required: false }) || 'all';
    includeOpenButton = body.include_open_button !== false; // default true
    dryRun = !!body.dry_run;
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Platform-wide rate limit. Without it a fat-fingered admin could spam every
  // owner repeatedly inside a minute and burn down their trust.
  if (!dryRun && Date.now() - lastBroadcastAt < RATE_LIMIT_MS) {
    const waitSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastBroadcastAt)) / 1000);
    return NextResponse.json({ error: `Please wait ${waitSec}s before sending another broadcast.` }, { status: 429 });
  }

  const recipients = await selectRecipients(segment);
  if (!recipients.length) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, total: 0, message: 'No owners in this segment.' });
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dry_run: true, total: recipients.length, segment });
  }

  lastBroadcastAt = Date.now();

  // Owners can quietly disable platform broadcasts later — we don't have a
  // field for it yet, but the message includes a "Reply STOP" line so they
  // can ask us to stop, matching the customer broadcast convention.
  const FOOTER = '\n\n— MiniMe · Reply STOP if you don\'t want these updates.';
  const baseText = message.trim().slice(0, 4096 - FOOTER.length) + FOOTER;

  // Optional "Open MiniMe" button that deep-links to the mini app.
  const miniAppUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  const replyMarkup = includeOpenButton && miniAppUrl
    ? { inline_keyboard: [[{ text: '📱 Open MiniMe', web_app: { url: miniAppUrl } }]] }
    : undefined;

  let sent = 0, failed = 0;
  const failures = [];

  for (const b of recipients) {
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    if (!chatId) { failed++; continue; }

    // Lightweight personalisation: "Hi <Name>," prepended if we know it.
    const greeting = b.owner_name ? `Hi ${b.owner_name.split(' ')[0]},\n\n` : '';
    const text = (greeting + baseText).slice(0, 4096);

    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        sent++;
      } else {
        failed++;
        // Telegram returns a JSON body even on non-2xx — useful for spotting
        // bot-blocked / chat-not-found patterns later.
        const j = await r.json().catch(() => ({}));
        failures.push({ business_id: b.id, code: r.status, desc: j?.description?.slice(0, 80) });
      }
    } catch (e) {
      failed++;
      failures.push({ business_id: b.id, code: 0, desc: e.message?.slice(0, 80) });
    }
    // ~20 msg/s — Telegram allows ~30/s for bots.
    await sleep(50);
  }

  console.log(`[admin/notify-owners] segment=${segment} sent=${sent} failed=${failed} total=${recipients.length}`);

  await audit({
    business_id: null,
    actor_type: 'platform_admin',
    actor_id: String(tg.id),
    action: 'notify_owners.sent',
    resource_type: 'broadcast',
    resource_id: null,
    metadata: {
      segment,
      sent,
      failed,
      total: recipients.length,
      message_preview: message.slice(0, 120),
      failure_samples: failures.slice(0, 10),
    },
    request,
  });

  return NextResponse.json({ ok: true, sent, failed, total: recipients.length, segment });
}
