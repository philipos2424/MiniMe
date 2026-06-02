/**
 * POST /api/broadcast
 * Send a message from the owner bot to a segment of customers.
 *
 * Body:
 *   message   string  — the text to send (max 4096 chars)
 *   segment   'all' | 'gold' | 'silver' | 'bronze' | 'ordered'
 *
 * Rate-limited to 1 broadcast per 5 minutes per business.
 * Telegram limits: ~30 messages/sec — we throttle to 20/sec.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { decrypt } from '../../../lib/server/crypto';
import { supabase } from '../../../lib/server/db';
import { audit } from '../../../lib/server/audit';
import { str, oneOf, ValidationError, validationResponse } from '../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Simple in-process rate limit: 1 broadcast per 5 min per business
const lastBroadcast = new Map();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(request) {
  // Return a preview count for the selected segment
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const segment = new URL(request.url).searchParams.get('segment') || 'all';
  const sb = supabase();
  let q = sb.from('customers').select('id', { count: 'exact', head: true })
    .eq('business_id', business.id)
    .not('telegram_id', 'is', null)
    .neq('broadcast_opted_out', true);

  if (segment === 'gold')          q = q.eq('tier', 'gold');
  if (segment === 'silver')        q = q.in('tier', ['silver', 'gold']);
  if (segment === 'bronze')        q = q.in('tier', ['bronze', 'silver', 'gold']);
  if (segment === 'ordered')       q = q.gt('total_orders', 0);
  if (segment === 'never_ordered') q = q.eq('total_orders', 0);
  if (segment === 'inactive_30d') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    q = q.lt('last_active_at', thirtyDaysAgo);
  }

  const { count } = await q;
  return NextResponse.json({ count: count || 0 });
}

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!business.telegram_bot_token_enc) {
    return NextResponse.json({ error: 'no_bot_linked' }, { status: 400 });
  }

  // Rate limit: 1 broadcast per 5 minutes
  const last = lastBroadcast.get(business.id);
  if (last && Date.now() - last < 5 * 60 * 1000) {
    const waitSec = Math.ceil((5 * 60 * 1000 - (Date.now() - last)) / 1000);
    return NextResponse.json({ error: `Please wait ${waitSec}s before sending another broadcast.` }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  let message, segment;
  try {
    // Broadcast messages go to Telegram as Markdown — strip HTML but allow Telegram MD syntax
    message = str(body.message, { field: 'message', min: 1, max: 4096, required: true, stripHtml: true });
    const ALLOWED_SEGMENTS = ['all', 'ordered', 'never_ordered', 'inactive_30d', 'gold', 'silver', 'bronze'];
    segment = oneOf(body.segment, ALLOWED_SEGMENTS, { field: 'segment', required: false }) || 'all';
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  let token;
  try { token = decrypt(business.telegram_bot_token_enc); }
  catch { return NextResponse.json({ error: 'decrypt_failed' }, { status: 500 }); }

  // Fetch target customers
  const sb = supabase();
  let q = sb.from('customers')
    .select('id, telegram_id, name')
    .eq('business_id', business.id)
    .not('telegram_id', 'is', null)
    .neq('broadcast_opted_out', true);  // respect opt-outs

  if (segment === 'gold')          q = q.eq('tier', 'gold');
  if (segment === 'silver')        q = q.in('tier', ['silver', 'gold']);
  if (segment === 'bronze')        q = q.in('tier', ['bronze', 'silver', 'gold']);
  if (segment === 'ordered')       q = q.gt('total_orders', 0);
  if (segment === 'never_ordered') q = q.eq('total_orders', 0);
  if (segment === 'inactive_30d') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    q = q.lt('last_active_at', thirtyDaysAgo);
  }

  const { data: customers } = await q.limit(500);
  if (!customers?.length) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, message: 'No customers in this segment.' });
  }

  lastBroadcast.set(business.id, Date.now());

  // Anti-spam / marketing-consent compliance: every broadcast must carry a
  // visible opt-out. A STOP/unsubscribe handler already exists (replyEngine) and
  // broadcasts already skip opted-out customers — this makes the exit reachable
  // from inside the message itself, as anti-spam rules generally require.
  const OPT_OUT_FOOTER = '\n\nReply STOP to unsubscribe.';
  const broadcastText = message.trim().slice(0, 4096 - OPT_OUT_FOOTER.length) + OPT_OUT_FOOTER;

  let sent = 0, failed = 0;
  for (const c of customers) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: c.telegram_id,
          text: broadcastText,
          parse_mode: 'Markdown',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) sent++; else failed++;
    } catch { failed++; }
    // Throttle: Telegram allows ~30/sec, we do ~20/sec to be safe
    await sleep(50);
  }

  // Save broadcast to history (stored in notification_prefs.broadcast_history)
  try {
    const { data: biz } = await sb.from('businesses').select('notification_prefs').eq('id', business.id).single();
    const history = biz?.notification_prefs?.broadcast_history || [];
    const entry = {
      id: Date.now().toString(),
      sent_at: new Date().toISOString(),
      segment,
      message: message.trim().slice(0, 200),
      sent_count: sent,
      failed_count: failed,
    };
    const updated = [entry, ...history].slice(0, 20); // keep last 20
    await sb.from('businesses').update({
      notification_prefs: { ...(biz?.notification_prefs || {}), broadcast_history: updated },
    }).eq('id', business.id);
  } catch (e) { console.warn('[broadcast] history save failed:', e.message); }

  console.log(`[broadcast] ${business.name}: sent=${sent} failed=${failed} segment=${segment}`);

  await audit({
    business_id: business.id, actor_type: 'owner', actor_id: String(tg.id),
    action: 'broadcast.sent', resource_type: 'broadcast', resource_id: null,
    metadata: { segment, sent, failed, message_preview: message.slice(0, 100) }, request,
  });

  return NextResponse.json({ ok: true, sent, failed });
}
