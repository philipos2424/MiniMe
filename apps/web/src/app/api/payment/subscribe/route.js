/**
 * POST /api/payment/subscribe
 * Initiates subscription payment for MiniMe Pro (2,500 ETB/month).
 * Supports Stripe, Chapa, Telebirr, CBE Birr, and PayPal.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { SUBSCRIPTION_PLANS, upgradeSubscription, planPriceEtb } from '../../../../lib/server/billing';
import { supabase } from '../../../../lib/server/db';
import { getSetting, getSettings } from '../../../../lib/server/platformSettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Where the money actually goes ────────────────────────────────────────────
//
// NO FALLBACK VALUES. These used to default to '+251911000000' and account
// '1000000000000', so with the env vars unset every owner who chose a manual
// method was shown a real-looking account number that belongs to nobody, and
// told to send 1,999 birr to it. A placeholder is fine in a config file and
// catastrophic on a payment screen — if it isn't configured, the method must
// be unavailable rather than wrong.
//
// PLATFORM_BANK_* is deliberately generic (bank name is configurable) so this
// works with NBE, CBE, Awash or anything else without a code change.
// Values come from platform_settings (editable at /admin/settings) and fall
// back to the original env vars. getSetting() returns null for anything unset
// or left as a 'placeholder' — never a stand-in value.
export async function platformAccounts() {
  const s = await getSettings([
    'payment.telebirr.phone', 'payment.telebirr.name',
    'payment.bank.name', 'payment.bank.account', 'payment.bank.holder',
  ]);
  return {
    telebirr: {
      phone: s['payment.telebirr.phone'],
      name:  s['payment.telebirr.name'],
    },
    bank: {
      bankName: s['payment.bank.name'],
      account:  s['payment.bank.account'],
      name:     s['payment.bank.holder'],
    },
  };
}

/**
 * Which payment rails are actually usable right now.
 *
 * A rail that isn't configured must be OFF, not silently "successful". See
 * the guard below for why.
 */
export async function availableRails() {
  const s = await getSettings([
    'gateway.stripe.secret', 'gateway.paypal.id', 'gateway.paypal.secret',
    'gateway.chapa.secret', 'payment.telebirr.phone', 'payment.bank.account',
  ]);
  return {
    telebirr: !!s['payment.telebirr.phone'],
    bank:     !!s['payment.bank.account'],
    chapa:    !!s['gateway.chapa.secret'],
    stripe:   !!s['gateway.stripe.secret'],
    paypal:   !!(s['gateway.paypal.id'] && s['gateway.paypal.secret']),
  };
}

// Escape hatch for local development ONLY. Grants Pro without payment, so it
// is double-gated: an explicit flag AND a non-production environment. Never
// set this in Vercel.
function simulationAllowed() {
  return process.env.ALLOW_SIMULATED_PAYMENTS === '1' && process.env.NODE_ENV !== 'production';
}

/**
 * The gateway isn't configured. Historically each rail "fell back" to calling
 * upgradeSubscription() directly and returning status:'completed' — which
 * meant that with no Stripe/PayPal/Chapa keys set, ANY owner could pick one of
 * those methods and be granted Pro instantly, for free. Refuse instead.
 */
function railUnavailable(method) {
  console.error(`[subscribe] BLOCKED unpaid upgrade: ${method} is not configured`);
  return NextResponse.json({
    error: 'payment_method_unavailable',
    method,
    message: 'That payment method isn\'t available yet. Please choose another.',
  }, { status: 503 });
}

export async function POST(request) {
  try {
    const initData = request.headers.get('x-telegram-init-data');
    let business = null;

    if (initData && verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
      const tgUser = parseTelegramUser(initData);
      if (tgUser?.id) business = await findBusinessForUser(tgUser.id);
    }

    if (!business) {
      const authHeader = request.headers.get('x-business-id');
      if (authHeader) {
        const { data } = await supabase().from('businesses').select('*').eq('id', authHeader).single();
        business = data;
      }
    }

    if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { plan = 'pro', method = 'chapa', durationMonths = 1 } = body;

    const planDef = SUBSCRIPTION_PLANS[String(plan).toLowerCase()];
    if (!planDef) {
      return NextResponse.json({ error: `Unknown plan: ${plan}` }, { status: 400 });
    }
    // Retired USD credit tiers are readable for existing subscribers but must
    // not be sellable — nobody should be able to buy their way onto a plan we
    // no longer support by posting `plan: 'business'`.
    if (planDef.legacy || planDef.id === 'free') {
      return NextResponse.json({ error: `Plan not available for purchase: ${plan}` }, { status: 400 });
    }

    const txRef = `sub-${method.slice(0, 4)}-${business.id.slice(0, 8)}-${Date.now()}`;
    const baseUrl = (process.env.WEB_URL || `https://${request.headers.get('host') || 'web-theta-one-68.vercel.app'}`).replace(/\/$/, '');

    // ── 1. Stripe Payment Flow ─────────────────────────────────────────────
    if (method === 'stripe') {
      const stripeKey = await getSetting('gateway.stripe.secret');
      if (stripeKey && stripeKey !== 'sk-placeholder') {
        try {
          const params = new URLSearchParams();
          params.append('payment_method_types[0]', 'card');
          params.append('mode', 'payment');
          params.append('line_items[0][price_data][currency]', 'usd');
          params.append('line_items[0][price_data][product_data][name]', `MiniMe AI — ${planDef.name} Plan`);
          params.append('line_items[0][price_data][product_data][description]', `MiniMe ${planDef.name} — ${durationMonths} month${durationMonths === 1 ? '' : 's'}`);
          params.append('line_items[0][price_data][unit_amount]', String(Math.round((planDef.priceMonthlyUsd || 0) * 100 * durationMonths)));
          params.append('line_items[0][quantity]', '1');
          params.append('success_url', `${baseUrl}/settings/billing?paid=1&tx_ref=${txRef}`);
          params.append('cancel_url', `${baseUrl}/settings/billing?cancelled=1`);
          params.append('client_reference_id', business.id);
          params.append('metadata[businessId]', business.id);
          params.append('metadata[plan]', planDef.id);
          params.append('metadata[txRef]', txRef);

          const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          });

          const session = await r.json();

          if (session.url) {
            return NextResponse.json({
              ok: true,
              method: 'stripe',
              checkout_url: session.url,
              tx_ref: txRef,
              plan: planDef.id,
            });
          }
        } catch (stripeErr) {
          console.warn('[stripe] Stripe init warning:', stripeErr.message);
        }
      }

      // Reached only when Stripe is unconfigured or failed to create a session.
      if (!simulationAllowed()) return railUnavailable('stripe');
      const updatedSub = await upgradeSubscription(business.id, {
        planName: planDef.id,
        paymentReference: txRef,
        paymentMethod: 'stripe',
        durationMonths,
      });
      return NextResponse.json({
        ok: true, method: 'stripe', status: 'completed', simulated: true,
        subscription: updatedSub, message: 'Simulated upgrade (dev only)',
      });
    }

    // ── 2. PayPal Payment Flow ─────────────────────────────────────────────
    if (method === 'paypal') {
      const paypalClientId = await getSetting('gateway.paypal.id');
      const paypalSecret = await getSetting('gateway.paypal.secret');

      if (paypalClientId && paypalSecret) {
        try {
          // Exchange client credentials for access token
          const auth = Buffer.from(`${paypalClientId}:${paypalSecret}`).toString('base64');
          const tokenResp = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials',
          });
          const tokenData = await tokenResp.json();

          if (tokenData.access_token) {
            const orderResp = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [
                  {
                    reference_id: txRef,
                    description: `MiniMe AI — ${planDef.name} Plan`,
                    amount: {
                      currency_code: 'USD',
                      value: String(planDef.priceMonthlyUsd * durationMonths),
                    },
                  },
                ],
                application_context: {
                  return_url: `${baseUrl}/settings/billing?paid=1&tx_ref=${txRef}`,
                  cancel_url: `${baseUrl}/settings/billing?cancelled=1`,
                },
              }),
            });
            const orderData = await orderResp.json();
            const approveLink = orderData.links?.find(l => l.rel === 'approve')?.href;

            if (approveLink) {
              return NextResponse.json({
                ok: true,
                method: 'paypal',
                checkout_url: approveLink,
                tx_ref: txRef,
                plan: planDef.id,
              });
            }
          }
        } catch (paypalErr) {
          console.warn('[paypal] PayPal init warning:', paypalErr.message);
        }
      }

      if (!simulationAllowed()) return railUnavailable('paypal');
      const updatedSub = await upgradeSubscription(business.id, {
        planName: planDef.id,
        paymentReference: txRef,
        paymentMethod: 'paypal',
        durationMonths,
      });
      return NextResponse.json({
        ok: true, method: 'paypal', status: 'completed', simulated: true,
        subscription: updatedSub, message: 'Simulated upgrade (dev only)',
      });
    }

    // ── 3. Chapa Payment Flow ──────────────────────────────────────────────
    if (method === 'chapa') {
      const chapaKey = await getSetting('gateway.chapa.secret');
      const etbPrice = planPriceEtb(planDef, durationMonths);

      if (chapaKey && chapaKey !== 'sk-placeholder') {
        try {
          const email = business.email || `${business.id.slice(0, 8)}@minime.app`;
          const fullName = business.owner_name || 'Owner';
          const nameParts = fullName.split(' ');

          const r = await fetch('https://api.chapa.co/v1/transaction/initialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chapaKey}` },
            body: JSON.stringify({
              amount: String(etbPrice),
              currency: 'ETB',
              email,
              first_name: nameParts[0] || 'Owner',
              last_name: nameParts[1] || business.name || 'Business',
              tx_ref: txRef,
              title: `MiniMe AI — ${planDef.name}`,
              description: `${planDef.name} Plan for ${business.name}`,
              callback_url: `${baseUrl}/api/payment/webhook`,
              return_url: `${baseUrl}/settings/billing?paid=1&tx_ref=${txRef}`,
            }),
          });
          const chapaRes = await r.json();

          if (chapaRes?.status === 'success' && chapaRes?.data?.checkout_url) {
            return NextResponse.json({
              ok: true,
              method: 'chapa',
              checkout_url: chapaRes.data.checkout_url,
              tx_ref: txRef,
              plan: planDef.id,
            });
          }
        } catch (chapaErr) {
          console.warn('[chapa] Chapa init warning:', chapaErr.message);
        }
      }

      if (!simulationAllowed()) return railUnavailable('chapa');
      const updatedSub = await upgradeSubscription(business.id, {
        planName: planDef.id,
        paymentReference: txRef,
        paymentMethod: 'chapa',
        durationMonths,
      });
      return NextResponse.json({
        ok: true, method: 'chapa', status: 'completed', simulated: true,
        subscription: updatedSub, message: 'Simulated upgrade (dev only)',
      });
    }

    // ── 4. Telebirr & bank transfer (manual, proof-of-payment) ────────────
    // 'cbe'/'cbe_manual' still accepted so older clients keep working; the
    // bank itself is whatever PLATFORM_BANK_NAME says (NBE, CBE, Awash, …).
    if (['telebirr', 'telebirr_manual', 'bank', 'cbe', 'cbe_manual'].includes(method)) {
      const isTelebirr = method.includes('telebirr');
      const accounts = await platformAccounts();
      const acct = isTelebirr ? accounts.telebirr : accounts.bank;

      // Never hand out payment instructions we can't stand behind. Without
      // this an owner was told to send money to a placeholder account.
      if (isTelebirr ? !acct.phone : !acct.account) {
        return railUnavailable(isTelebirr ? 'telebirr' : 'bank');
      }

      const refCode = `SUB-${business.id.slice(0, 6).toUpperCase()}`;
      const etbPrice = planPriceEtb(planDef, durationMonths);

      const instructions = isTelebirr
        ? { phone: acct.phone, name: acct.name, amount: etbPrice, currency: 'ETB', reference: refCode }
        : { bank: acct.bankName, account: acct.account, name: acct.name, amount: etbPrice, currency: 'ETB', reference: refCode };

      await supabase().from('businesses').update({
        payment_ref: txRef,
        payment_method: isTelebirr ? 'telebirr' : 'bank_transfer',
        payment_notes: `Pending manual ${isTelebirr ? 'Telebirr' : (acct.bankName || 'bank')} payment for ${planDef.name}`,
      }).eq('id', business.id);

      return NextResponse.json({
        ok: true,
        method: isTelebirr ? 'telebirr' : 'bank',
        instructions,
        tx_ref: txRef,
        plan: planDef.id,
        amount: etbPrice,
        next_step: 'upload_proof',
        upload_url: '/api/payment/subscribe/proof',
      });
    }

    return NextResponse.json({ error: `Unsupported payment method: ${method}` }, { status: 400 });
  } catch (e) {
    console.error('[subscribe] POST error:', e.message);
    return NextResponse.json({ error: e.message || 'Payment initiation failed' }, { status: 500 });
  }
}
