/**
 * POST /api/admin/verify-et/test — check the saved verify.et key works.
 *
 * Exists so the key can be validated without anyone reading it back out: it is
 * stored encrypted and never returned to the browser, so "is this key good?"
 * can only be answered by the server trying it. Uses the history endpoint
 * (verification:read), which authenticates without spending a verification
 * credit — a connection test should not cost money.
 *
 * Also reports whether the settlement identifiers are configured, because a
 * valid key with no CBE account suffix still can't verify a bank transfer, and
 * that failure would otherwise only show up on a real merchant's payment.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';
import { ping, verifyEtConfig } from '../../../../../lib/server/verifyEt';
import { audit } from '../../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const cfg = await verifyEtConfig();
  const result = await ping();

  const readiness = {
    api_key: !!cfg.apiKey,
    webhook_secret: !!cfg.webhookSecret,
    // CBE verification is impossible without the 8-digit suffix of the
    // receiving account — verify.et requires it in the payload.
    cbe_ready: !!cfg.apiKey && !!cfg.bankSuffix && cfg.bankSuffix.length === 8,
    telebirr_ready: !!cfg.apiKey && !!cfg.telebirrAccount,
    bank_suffix_digits: cfg.bankSuffix ? cfg.bankSuffix.length : 0,
  };

  const blockers = [];
  if (!cfg.apiKey) blockers.push('No verify.et API key saved.');
  if (cfg.bankSuffix && cfg.bankSuffix.length !== 8) {
    blockers.push(`Account last-8-digits is ${cfg.bankSuffix.length} digits — verify.et requires exactly 8.`);
  }
  if (!cfg.bankSuffix) blockers.push('No CBE account suffix — bank transfers cannot be verified, only Telebirr.');
  if (!cfg.telebirrAccount) blockers.push('No Telebirr number — Telebirr payments cannot be matched to your account.');
  if (!cfg.webhookSecret) blockers.push('No webhook secret — slow verifications will be polled instead of pushed (still works).');

  // Result only, never the key. Failures are as worth recording as successes:
  // a run of invalid_key results is what a leaked-and-rotated key looks like.
  await audit({
    actor_type: 'platform_admin',
    actor_id: String(admin.id),
    action: 'verifyet.connection_test',
    resource_type: 'platform_settings',
    metadata: { ok: result.ok, reason: result.reason || null, readiness },
    request,
  }).catch(() => {});

  return NextResponse.json({ ok: result.ok, ...result, readiness, blockers });
}
