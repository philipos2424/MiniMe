/**
 * GET  /api/discounts — list all discounts for this business
 * POST /api/discounts — create a new discount code
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';
import { requireOwner } from '../../../lib/server/auth';
import { audit } from '../../../lib/server/audit';
import { code as codeVal, num, oneOf, isoDate, ValidationError, validationResponse } from '../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authHeaders(request) {
  const initData = request.headers.get('x-telegram-init-data');
  return initData;
}

export async function GET(request) {
  const initData = authHeaders(request);
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: discounts } = await supabase()
    .from('discounts')
    .select('*')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ discounts: discounts || [] });
}

export async function POST(request) {
  const initData = authHeaders(request);
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can manage discounts.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  // ── Input validation ──────────────────────────────────────────────────────
  let code, type, value, min_order, max_uses, expires_at;
  try {
    code       = codeVal(body.code, { field: 'code', min: 2, max: 20 });
    type       = oneOf(body.type, ['percent', 'fixed'], { field: 'type', required: false }) || 'percent';
    value      = num(body.value, { field: 'value', min: 0.01, max: type === 'percent' ? 100 : 10_000_000, required: true });
    min_order  = body.min_order ? num(body.min_order, { field: 'min_order', min: 0, max: 10_000_000 }) : null;
    max_uses   = body.max_uses  ? num(body.max_uses, { field: 'max_uses', min: 1, max: 1_000_000, integer: true }) : null;
    expires_at = body.expires_at ? isoDate(body.expires_at, { field: 'expires_at', pastAllowed: false }) : null;
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Check for duplicate code in this business
  const { data: existing } = await supabase()
    .from('discounts')
    .select('id')
    .eq('business_id', business.id)
    .eq('code', code)
    .maybeSingle();

  if (existing) return NextResponse.json({ error: 'code_already_exists' }, { status: 400 });

  const { data, error } = await supabase()
    .from('discounts')
    .insert({
      business_id: business.id,
      code,
      type,
      value,
      min_order,
      max_uses,
      used_count: 0,
      expires_at,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    // Table may not exist yet — return helpful error
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'table_missing', detail: 'Run the discounts migration first.' }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    business_id: business.id, actor_type: 'owner', actor_id: String(tg.id),
    action: 'discount.created', resource_type: 'discount', resource_id: data?.id,
    metadata: { code, type, value }, request,
  });

  return NextResponse.json({ ok: true, discount: data });
}
