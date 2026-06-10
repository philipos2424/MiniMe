/**
 * GET /api/cron/scheduled-messages
 *
 * Runs every 15 minutes. Finds scheduled messages whose send_at has passed,
 * sends them, and marks them as sent.
 *
 * Supports:
 *   - target_type: 'all' → all customers of that business
 *   - target_type: 'segment' → ordered/never_ordered/inactive_30d/gold/silver
 *   - target_type: 'customer' → specific customer telegram_id
 *   - target_type: 'phone' → forward to external phone (best-effort)
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  // Find due messages
  const { data: dueMsgs } = await sb
    .from('scheduled_messages')
    .select('*, businesses(telegram_bot_token_enc, telegram_bot_username, owner_telegram_id, telegram_biz_conn_id)')
    .eq('status', 'pending')
    .lte('send_at', now)
    .limit(20);

  if (!dueMsgs?.length) return NextResponse.json({ ok: true, sent: 0 });

  let totalSent = 0;
  let totalFailed = 0;

  for (const msg of dueMsgs) {
    // Mark as sending to prevent double-sending
    await sb.from('scheduled_messages').update({ status: 'sending' }).eq('id', msg.id);

    const biz = msg.businesses;
    const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

    // Resolve token: custom bot → platform agent token for shared-mode businesses
    let token;
    if (biz?.telegram_bot_token_enc) {
      try { token = decrypt(biz.telegram_bot_token_enc); }
      catch { await sb.from('scheduled_messages').update({ status: 'failed', error_message: 'decrypt_failed' }).eq('id', msg.id); continue; }
    } else if (AGENT_TOKEN) {
      token = AGENT_TOKEN;
    } else {
      await sb.from('scheduled_messages').update({ status: 'failed', error_message: 'no_bot_token' }).eq('id', msg.id);
      continue;
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors = [];

    // Get target customers
    let targets = []; // array of { telegram_id }

    if (msg.target_type === 'customer' && msg.target_value) {
      targets = [{ telegram_id: msg.target_value }];
    } else if (msg.target_type === 'all') {
      const { data } = await sb.from('customers').select('telegram_id')
        .eq('business_id', msg.business_id).not('telegram_id', 'is', null).limit(500);
      targets = data || [];
    } else if (msg.target_type === 'segment') {
      let query = sb.from('customers').select('telegram_id').eq('business_id', msg.business_id).not('telegram_id', 'is', null);
      const seg = msg.target_value;
      if (seg === 'ordered')       query = query.gt('total_orders', 0);
      if (seg === 'never_ordered') query = query.eq('total_orders', 0);
      if (seg === 'gold')          query = query.gte('loyalty_points', 500);
      if (seg === 'silver')        query = query.gte('loyalty_points', 100);
      if (seg === 'inactive_30d') {
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        query = query.lt('last_seen_at', cutoff);
      }
      const { data } = await query.limit(500);
      targets = data || [];
    } else if (msg.target_type === 'phone') {
      // Forward to a phone number — try to find them in customers, otherwise skip
      // (Telegram doesn't allow unsolicited DMs to phone numbers)
      errors.push('phone_target_not_supported_via_telegram');
    }

    // Send to each target
    for (const t of targets) {
      if (!t.telegram_id) continue;
      try {
        let result;
        if (msg.media_url) {
          // Try to send as photo
          result = await tg(token, 'sendPhoto', {
            chat_id: t.telegram_id,
            photo: msg.media_url,
            caption: msg.message,
            parse_mode: 'Markdown',
          });
          if (!result.ok) {
            // Fall back to text if photo fails
            result = await tg(token, 'sendMessage', { chat_id: t.telegram_id, text: msg.message, parse_mode: 'Markdown' });
          }
        } else {
          result = await tg(token, 'sendMessage', {
            chat_id: t.telegram_id,
            text: msg.message,
            parse_mode: 'Markdown',
          });
        }
        if (result.ok) sentCount++;
        else { failedCount++; errors.push(result.description || 'unknown'); }
      } catch (e) {
        failedCount++;
        errors.push(e.message);
      }
      // Small delay to avoid hitting Telegram rate limits
      await new Promise(r => setTimeout(r, 50));
    }

    // Update status
    await sb.from('scheduled_messages').update({
      status: failedCount > 0 && sentCount === 0 ? 'failed' : 'sent',
      sent_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount,
      error_message: errors.length ? errors.slice(0, 3).join('; ') : null,
    }).eq('id', msg.id);

    totalSent += sentCount;
    totalFailed += failedCount;

    // Notify owner that scheduled message was sent
    if (biz.owner_telegram_id && sentCount > 0) {
      const label = msg.label ? ` "${msg.label}"` : '';
      await tg(token, 'sendMessage', {
        chat_id: biz.owner_telegram_id,
        parse_mode: 'Markdown',
        text: `📤 *Scheduled message sent!*${label}\n\nSent to *${sentCount}* customer${sentCount > 1 ? 's' : ''}${failedCount > 0 ? `, ${failedCount} failed` : ''}.\n\n_"${msg.message.slice(0, 100)}${msg.message.length > 100 ? '…' : ''}"_`,
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, processed: dueMsgs.length, sent: totalSent, failed: totalFailed });
}
