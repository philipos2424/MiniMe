/**
 * GET /api/admin/payments
 *
 * Who has actually paid, who is on Pro without paying, and every payment on
 * record. Admin only.
 *
 * The existing /api/admin/billing reports the credit system, which no longer
 * reflects how MiniMe is sold. This reports money: it joins each business to
 * its completed inbound payments and classifies it with paymentState(), so
 * "granted (unpaid)" is visible as its own bucket instead of hiding inside
 * "Pro".
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { paymentState, isRevenueBearing } from '../../../../lib/paymentState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!await requireAdminRequest(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabase();
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('state');          // optional bucket filter
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 200));

  const [{ data: businesses }, { data: payments }] = await Promise.all([
    sb.from('businesses')
      .select('id, name, owner_name, owner_telegram_id, plan_tier, subscription_plan, subscription_status, subscription_expires_at, trial_ends_at, payment_ref, payment_bank_ref, payment_proof_url, payment_method, payment_verified, payment_notes, onboarding_completed, created_at, updated_at')
      .order('created_at', { ascending: false }),
    sb.from('payments')
      .select('id, business_id, amount, currency, method, status, reference, description, created_at, completed_at')
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  const rows = businesses || [];
  const pays = payments || [];

  // Latest verify.et verdict per business. The table ships in
  // supabase/migrations/verifyet_payment_verification.sql; treat its absence as
  // "no verifications yet" rather than failing the whole payments screen.
  const verifByBiz = new Map();
  try {
    const { data: verifs } = await sb.from('payment_verifications')
      .select('business_id, state, accepted, reason, amount_etb, expected_etb, sender, matched, match_confidence, bank_reference, source, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    for (const v of verifs || []) {
      if (!verifByBiz.has(v.business_id)) verifByBiz.set(v.business_id, v);
    }
  } catch (e) {
    console.warn('[admin/payments] verifications unavailable:', e.message);
  }

  // Payment-proof screenshots live in the `documents` bucket, which is
  // private (no public-read policy) — every uploader nonetheless calls
  // getPublicUrl() and stores that string, which 404s ("Bucket not found")
  // for anyone who opens it, this admin screen included. Re-sign each one
  // to a URL that actually resolves rather than changing the bucket's
  // public/private posture, which other document types also rely on.
  const signedProofByBiz = new Map();
  const proofRows = rows.filter(b => b.payment_proof_url);
  if (proofRows.length) {
    await Promise.all(proofRows.map(async b => {
      const m = String(b.payment_proof_url).match(/\/object\/public\/documents\/([^?]+)/);
      if (!m) return;
      try {
        const { data, error } = await sb.storage.from('documents').createSignedUrl(decodeURIComponent(m[1]), 3600);
        if (!error && data?.signedUrl) signedProofByBiz.set(b.id, data.signedUrl);
      } catch (e) {
        console.warn('[admin/payments] proof sign failed:', e.message);
      }
    }));
  }

  // Completed payments per business — the ground truth for "has paid".
  const paidCount = new Map();
  const paidTotal = new Map();
  for (const p of pays) {
    if (!['completed', 'paid', 'fulfilled'].includes(String(p.status))) continue;
    paidCount.set(p.business_id, (paidCount.get(p.business_id) || 0) + 1);
    // Only ETB is real revenue here; the USD rows are legacy mislabelling.
    if (p.currency === 'ETB') {
      paidTotal.set(p.business_id, (paidTotal.get(p.business_id) || 0) + Number(p.amount || 0));
    }
  }

  const classified = rows.map(b => {
    const n = paidCount.get(b.id) || 0;
    const state = paymentState(b, n);
    return {
      id: b.id,
      name: b.name,
      owner: b.owner_name,
      telegram_id: b.owner_telegram_id,
      state,
      onboarded: !!b.onboarding_completed,
      payments: n,
      paid_etb: paidTotal.get(b.id) || 0,
      method: b.payment_method,
      reference: b.payment_ref,
      bank_reference: b.payment_bank_ref || null,
      // The screenshot itself, so a claim can be judged without leaving the page.
      // Re-signed (see above) — the raw stored URL 404s.
      proof_url: signedProofByBiz.get(b.id) || null,
      verified: !!b.payment_verified,
      notes: b.payment_notes || null,
      // Latest verify.et verdict, when there is one.
      verification: verifByBiz.get(b.id) || null,
      expires_at: b.subscription_expires_at,
      trial_ends_at: b.trial_ends_at,
      created_at: b.created_at,
    };
  });

  const summary = classified.reduce((acc, r) => {
    acc[r.state] = (acc[r.state] || 0) + 1;
    return acc;
  }, {});

  const revenueEtb = classified
    .filter(r => isRevenueBearing(r.state))
    .reduce((s, r) => s + r.paid_etb, 0);

  const shown = (filter ? classified.filter(r => r.state === filter) : classified).slice(0, limit);

  return NextResponse.json({
    ok: true,
    summary,
    totals: {
      businesses: classified.length,
      revenue_etb: revenueEtb,
      // The number that matters most: Pro access nobody paid for.
      granted_unpaid: summary.granted || 0,
      awaiting_check: summary.claimed || 0,
      // Merchants who asked how to pay and never finished — the warmest
      // leads on the platform, and previously not visible anywhere.
      interested: summary.interested || 0,
    },
    // Payment funnel, in the order a merchant moves through it. Each stage is
    // evidence-based, not status-based.
    funnel: (() => {
      const asked = rows.filter(b => b.payment_ref).length;
      const proof = rows.filter(b => b.payment_proof_url).length;
      const verified = rows.filter(b => b.payment_verified === true).length;
      return [
        { stage: 'Asked how to pay', count: asked },
        { stage: 'Submitted proof', count: proof },
        { stage: 'Verified', count: verified },
      ];
    })(),
    // The follow-up list: wanted to pay, never completed, newest first.
    interested: classified
      .filter(r => r.state === 'interested')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 100),
    businesses: shown,
    recent_payments: pays.slice(0, 50),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
