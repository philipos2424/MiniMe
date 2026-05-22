/**
 * GET /api/cron/reminders — fire any owner reminders whose due_at has passed.
 * Scheduled hourly via vercel.json. Reminder accuracy is ±1 hour.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { fireDueReminders } from '../../../../lib/server/ownerCommands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  const authed =
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  // Resolve bot token: custom bot first, fall back to platform agent token
  function resolveToken(b) {
    if (b?.telegram_bot_token_enc) {
      try { return decrypt(b.telegram_bot_token_enc); } catch {}
    }
    return AGENT_TOKEN || null;
  }

  const sb = supabase();
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, telegram_bot_token_enc, shop_code, onboarding_completed, owner_telegram_id, owner_private_chat_id, notification_prefs, subscription_status, trial_ends_at, subscription_expires_at, plan_tier')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)')
    .not('owner_telegram_id', 'is', null);

  const summary = [];
  const now = new Date();

  // ── Subscription / trial expiry notifications ───────────────────────────────
  const expiryNotified = [];
  for (const b of businesses || []) {
    const token = resolveToken(b);
    if (!token) continue;
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    if (!chatId || !token) continue;

    // Check trial expiry (notify at 3 days and 1 day remaining)
    if (b.subscription_status === 'trial' && b.trial_ends_at) {
      const daysLeft = Math.ceil((new Date(b.trial_ends_at) - now) / 86400000);
      if (daysLeft === 3 || daysLeft === 1) {
        const urgency = daysLeft === 1 ? '⚠️ Last day!' : '⏳';
        const miniAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || '';
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            parse_mode: 'Markdown',
            text: `${urgency} *Your MiniMe trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.*\n\nUpgrade now to keep your bot running, your customers replied to, and your data intact.\n\n👉 Tap below to upgrade.`,
            reply_markup: miniAppUrl ? {
              inline_keyboard: [[{ text: '💳 Upgrade now', web_app: { url: `${miniAppUrl}/settings/billing` } }]],
            } : undefined,
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
        expiryNotified.push({ business: b.name, type: 'trial', daysLeft });
      }
    }

    // Check paid subscription expiry (notify at 7 days and 2 days remaining)
    if (b.subscription_status === 'active' && b.subscription_expires_at) {
      const daysLeft = Math.ceil((new Date(b.subscription_expires_at) - now) / 86400000);
      if (daysLeft === 7 || daysLeft === 2) {
        const miniAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || '';
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            parse_mode: 'Markdown',
            text: `🔔 *Your MiniMe subscription renews in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.*\n\nMake sure your payment is ready so your bot stays uninterrupted.\n\nPlan: *${b.plan_tier || 'standard'}*`,
            reply_markup: miniAppUrl ? {
              inline_keyboard: [[{ text: '💳 Manage billing', web_app: { url: `${miniAppUrl}/settings/billing` } }]],
            } : undefined,
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
        expiryNotified.push({ business: b.name, type: 'subscription', daysLeft });
      }
    }
  }

  // ── Auto payment reminders (24h after order creation) ─────────────────────────
  // Sends customer a friendly nudge if they haven't paid yet
  const paymentReminders = [];
  try {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: unpaidOrders } = await sb.from('orders')
      .select('id, business_id, customer_id, total, currency, items, created_at, meta, customers(telegram_id, name)')
      .eq('status', 'awaiting_payment')
      .lte('created_at', cutoff24h)  // older than 24h
      .gte('created_at', cutoff48h)  // not older than 48h (only remind once)
      .not('customers', 'is', null)
      .limit(50);

    for (const order of unpaidOrders || []) {
      // Skip if already reminded
      if (order.meta?.payment_reminded) continue;
      const customer = order.customers;
      if (!customer?.telegram_id) continue;

      // Get business token
      const biz = (businesses || []).find(b => b.id === order.business_id);
      const token = resolveToken(biz);
      if (!token) continue;

      const items = Array.isArray(order.items) ? order.items : [];
      const itemList = items.length
        ? items.map(i => `• ${i.qty || 1}× ${i.name || 'item'}`).join('\n')
        : '';
      const total = order.total ? `${Number(order.total).toLocaleString()} ${order.currency || 'ETB'}` : '';

      const text = [
        `Hey ${customer.name || 'there'}! 👋`,
        ``,
        `Just a friendly reminder — your order from *${biz.name}* is waiting for payment:`,
        itemList,
        total ? `*Total: ${total}*` : '',
        ``,
        `Complete your payment to confirm the order. If you have any questions, just reply here!`,
      ].filter(Boolean).join('\n');

      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: customer.telegram_id, text, parse_mode: 'Markdown' }),
          signal: AbortSignal.timeout(8000),
        });
        // Mark as reminded so we don't send again
        await sb.from('orders').update({ meta: { ...(order.meta || {}), payment_reminded: true, reminded_at: new Date().toISOString() } }).eq('id', order.id);
        paymentReminders.push({ order: order.id, customer: customer.name });
      } catch (e) { console.warn('[reminder] payment nudge failed:', e.message); }
    }
  } catch (e) { console.warn('[reminder] payment reminder scan failed:', e.message); }

  // ── Post-delivery feedback requests (48h after fulfillment) ───────────────────
  // Automatically asks customers to rate their experience
  const feedbackRequests = [];
  try {
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    const { data: fulfilledOrders } = await sb.from('orders')
      .select('id, business_id, customer_id, total, currency, fulfilled_at, meta, customers(telegram_id, name)')
      .eq('status', 'fulfilled')
      .not('fulfilled_at', 'is', null)
      .lte('fulfilled_at', cutoff48h)  // fulfilled >48h ago
      .gte('fulfilled_at', cutoff72h)  // but <72h ago (1-shot window)
      .not('customers', 'is', null)
      .limit(50);

    for (const order of fulfilledOrders || []) {
      if (order.meta?.feedback_requested) continue;
      const customer = order.customers;
      if (!customer?.telegram_id) continue;

      const biz = (businesses || []).find(b => b.id === order.business_id);
      const token = resolveToken(biz);
      if (!token) continue;

      const text = `Hey ${customer.name || 'there'}! 🙏\n\nThank you for your order from *${biz.name}*! We hope everything was perfect.\n\nHow was your experience? (reply with a number)\n\n⭐ 1 — Poor\n⭐⭐ 2 — OK\n⭐⭐⭐ 3 — Good\n⭐⭐⭐⭐ 4 — Great\n⭐⭐⭐⭐⭐ 5 — Excellent!`;

      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: customer.telegram_id,
            text,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '⭐', callback_data: `fb_rate_${order.id}_1` },
                { text: '⭐⭐', callback_data: `fb_rate_${order.id}_2` },
                { text: '⭐⭐⭐', callback_data: `fb_rate_${order.id}_3` },
                { text: '⭐⭐⭐⭐', callback_data: `fb_rate_${order.id}_4` },
                { text: '⭐⭐⭐⭐⭐', callback_data: `fb_rate_${order.id}_5` },
              ]],
            },
          }),
          signal: AbortSignal.timeout(8000),
        });
        await sb.from('orders').update({ meta: { ...(order.meta || {}), feedback_requested: true, feedback_requested_at: new Date().toISOString() } }).eq('id', order.id);
        feedbackRequests.push({ order: order.id, customer: customer.name });
      } catch (e) { console.warn('[reminder] feedback request failed:', e.message); }
    }
  } catch (e) { console.warn('[reminder] feedback scan failed:', e.message); }

  // ── Customer re-engagement (runs every day, checks for 30-day inactive loyal customers) ──
  // Only runs on Thursdays to avoid spamming (pick any day with good open rates)
  const reEngaged = [];
  if (now.getDay() === 4) { // Thursday
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const sixtyDaysAgo  = new Date(Date.now() - 60 * 86400000).toISOString();

      for (const b of businesses || []) {
        // Only for active businesses
        const status = b.subscription_status || 'trial';
        if (status === 'cancelled' || status === 'expired') continue;

        const token = resolveToken(b);
        if (!token) continue;

        const { data: lapsedCustomers } = await sb.from('customers')
          .select('id, name, telegram_id, tier, loyalty_points, total_orders')
          .eq('business_id', b.id)
          .not('telegram_id', 'is', null)
          .gte('total_orders', 2)               // at least 2 past orders
          .lte('last_active_at', thirtyDaysAgo) // inactive for 30+ days
          .gte('last_active_at', sixtyDaysAgo)  // but not so long we annoy them
          .is('meta->re_engaged_at', null)       // haven't sent re-engagement yet
          .limit(20);

        for (const cust of lapsedCustomers || []) {
          const name = cust.name?.split(' ')[0] || 'there';
          const tier = cust.loyalty_points >= 500 ? 'Gold 🥇'
            : cust.loyalty_points >= 100 ? 'Silver 🥈' : 'Bronze 🥉';

          const text = [
            `Hey ${name}! 👋`,
            ``,
            `It's been a while since your last order from *${b.name}* — we miss you!`,
            ``,
            cust.loyalty_points > 0
              ? `You still have *${cust.loyalty_points} loyalty points* (${tier} tier) waiting for you. 🎁`
              : `You're a valued customer and we'd love to see you again.`,
            ``,
            `Tap below to browse what's new or place an order:`,
          ].join('\n');

          try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: cust.telegram_id,
                text,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    { text: '🛍️ Browse & order', callback_data: 'menu_products' },
                  ]],
                },
              }),
              signal: AbortSignal.timeout(8000),
            });
            // Mark as re-engaged
            await sb.from('customers').update({
              meta: { re_engaged_at: now.toISOString() },
            }).eq('id', cust.id);
            reEngaged.push({ business: b.name, customer: cust.name });
          } catch (e) { console.warn('[reEngage] failed:', e.message); }
          await new Promise(r => setTimeout(r, 100)); // throttle
        }
      }
    } catch (e) { console.warn('[reEngage] scan failed:', e.message); }
  }

  // ── Owner reminders (existing logic) ─────────────────────────────────────────
  for (const b of businesses || []) {
    if (!b.notification_prefs?.reminders?.length) continue;
    const token = resolveToken(b);
    if (!token) continue;
    try {
      const r = await fireDueReminders(token, b);
      if (r.fired) summary.push({ business: b.name, fired: r.fired });
    } catch (e) {
      summary.push({ business: b.name, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, expiry_notifications: expiryNotified, payment_reminders: paymentReminders, feedback_requests: feedbackRequests, re_engaged: reEngaged, reminders: summary });
}
// Note: requires_owner auto-clear is now handled inline by the brain/fast-path
// when they successfully reply. No cron needed.
