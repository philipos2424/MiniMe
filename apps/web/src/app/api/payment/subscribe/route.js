/**
 * POST /api/payment/subscribe
 * Initiates a Chapa subscription payment for a MiniMe Pro plan.
 * Returns { checkout_url } for the client to open.
 *
 * Plans supported:
 *   pro_monthly  — 2,500 ETB / month
 *   pro_annual   — 25,000 ETB / year (≈17% off)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLANS = {
  pro_monthly: { amount: 2500, label: 'MiniMe Pro — 1 month', months: 1 },
  pro_annual:  { amount: 25000, label: 'MiniMe Pro — 1 year',  months: 12 },
};

const PLATFORM_ACCOUNTS = {
  telebirr: {
    phone: process.env.PLATFORM_TELEBIRR_PHONE || '+251911000000',
    name: process.env.PLATFORM_TELEBIRR_NAME || 'MiniMe',
  },
  cbe: {
    account: process.env.PLATFORM_CBE_ACCOUNT || '1000000000000',
    name: process.env.PLATFORM_CBE_NAME || 'MiniMe',
    phone: process.env.PLATFORM_CBE_PHONE || '+251911000000',
  },
};

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { plan = 'pro_monthly', method = 'chapa' } = await request.json().catch(() => ({}));
  const planDef = PLANS[plan];
  if (!planDef) return NextResponse.json({ error: `Unknown plan: ${plan}` }, { status: 400 });

  // ── Manual payment flow (Telebirr / CBE) — skip Chapa, return instructions ──
  if (method === 'telebirr_manual' || method === 'cbe_manual') {
    const txRef = `sub-${method === 'telebirr_manual' ? 'tb' : 'cbe'}-${business.id.slice(0, 8)}-${Date.now()}`;
    const ref = `SUB-${business.id.slice(0, 6).toUpperCase()}`;
    const instructions = method === 'telebirr_manual'
      ? { phone: PLATFORM_ACCOUNTS.telebirr.phone, name: PLATFORM_ACCOUNTS.telebirr.name, amount: planDef.amount, currency: 'ETB', reference: ref }
      : { account: PLATFORM_ACCOUNTS.cbe.account, name: PLATFORM_ACCOUNTS.cbe.name, phone: PLATFORM_ACCOUNTS.cbe.phone, amount: planDef.amount, currency: 'ETB', reference: ref };

    await supabase().from('businesses').update({
      payment_ref: txRef,
      payment_method: method,
      payment_notes: `Pending manual ${method.replace('_manual', '')} payment for ${plan} — initiated ${new Date().toISOString()}`,
    }).eq('id', business.id);

    return NextResponse.json({
      ok: true,
      method,
      instructions,
      tx_ref: txRef,
      plan,
      amount: planDef.amount,
      months: planDef.months,
      next_step: 'upload_screenshot',
      upload_url: '/api/payment/subscribe/proof',
    });
  }

  // ── Chapa flow (default) ──
  const chapaKey = process.env.CHAPA_SECRET_KEY;
  if (!chapaKey) return NextResponse.json({ error: 'Payment not configured' }, { status: 503 });

  const txRef = `sub-${business.id.slice(0, 8)}-${Date.now()}`;
  const baseUrl = (process.env.WEB_URL || `https://${request.headers.get('host')}`).replace(/\/$/, '');

  // Build first/last name from owner_name or Telegram user
  const fullName = business.owner_name || [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Owner';
  const nameParts = fullName.split(' ');
  const firstName = nameParts[0] || 'Owner';
  const lastName  = nameParts.slice(1).join(' ') || business.name || 'Business';

  // Use a placeholder email if none set — Chapa requires it
  const email = business.email || `${business.id.slice(0, 8)}@minime.app`;

  let chapaRes;
  try {
    const r = await fetch('https://api.chapa.co/v1/transaction/initialize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chapaKey}`,
      },
      body: JSON.stringify({
        amount: String(planDef.amount),
        currency: 'ETB',
        email,
        first_name: firstName,
        last_name: lastName,
        tx_ref: txRef,
        title: planDef.label,
        description: `${planDef.label} for ${business.name}`,
        callback_url: `${baseUrl}/api/payment/callback`,
        return_url: `${baseUrl}/settings/billing?paid=1`,
        customization: {
          title: 'MiniMe Pro',
          description: planDef.label,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    chapaRes = await r.json();
  } catch (e) {
    return NextResponse.json({ error: `Chapa request failed: ${e.message}` }, { status: 502 });
  }

  if (!chapaRes?.status === 'success' && chapaRes?.status !== 'success') {
    return NextResponse.json({ error: chapaRes?.message || 'Chapa initialization failed' }, { status: 502 });
  }

  // Persist pending subscription record so the callback can look it up
  await supabase().from('businesses').update({
    payment_ref: txRef,
    payment_notes: `Pending ${plan} — initiated ${new Date().toISOString()}`,
  }).eq('id', business.id);

  return NextResponse.json({
    ok: true,
    checkout_url: chapaRes.data?.checkout_url,
    tx_ref: txRef,
    plan,
    amount: planDef.amount,
    months: planDef.months,
  });
}
