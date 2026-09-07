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
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { str, oneOf, ValidationError, validationResponse } from '../../../../lib/server/sanitize';
import { ALLOWED_SEGMENTS, selectRecipients, enrichRecipients, sendBroadcast, ACTIVE_WINDOW_MS } from '../../../../lib/server/outreach';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// In-process rate limit. Platform-wide because we're using one shared bot.
let lastBroadcastAt = 0;
const RATE_LIMIT_MS = 5 * 60 * 1000;

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
    // NOT gated on onboarding_completed here — the admin UI now lets you
    // hand-pick recipients from the "incomplete onboarding" segment
    // specifically, which by definition have onboarding_completed=false.
    // owner_telegram_id is still required since that's how we actually DM them.
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

  const { sent, failed, blocked, aborted_flood_wait: abortedFloodWait, failures, broadcast_id: broadcastId } = await sendBroadcast({
    token,
    recipients,
    message,
    includeOpenButton,
    source: { type: 'campaign', campaign_id: null },
  });

  console.log(`[admin/notify-owners] mode=${businessIds ? 'custom' : segment} sent=${sent} failed=${failed} blocked=${blocked} aborted=${abortedFloodWait} total=${recipients.length} broadcast_id=${broadcastId}`);

  await audit({
    business_id: null,
    actor_type: 'platform_admin',
    actor_id: String(tg.id),
    action: 'notify_owners.sent',
    resource_type: 'broadcast',
    resource_id: broadcastId,
    metadata: {
      mode: businessIds ? 'custom' : segment,
      broadcast_id: broadcastId,
      sent, failed, blocked, aborted_flood_wait: abortedFloodWait, total: recipients.length,
      message_preview: message.slice(0, 120),
      failure_samples: failures.slice(0, 10),
    },
    request,
  });

  return NextResponse.json({
    ok: true, sent, failed, blocked, aborted_flood_wait: abortedFloodWait, total: recipients.length,
    segment: businessIds ? 'custom' : segment,
    broadcast_id: broadcastId,
  });
}
