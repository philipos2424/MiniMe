/**
 * PATCH /api/customers/[id]
 * Body: { name: string }
 * Renames a customer record — owner only, scoped to their business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { str, name as nameVal, ValidationError, validationResponse } from '../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const { data: customer } = await sb.from('customers')
    .select('*')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!customer) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: orders } = await sb.from('orders')
    .select('id, status, total, currency, items, created_at')
    .eq('customer_id', params.id)
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({ customer, orders: orders || [] });
}

export async function PATCH(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sb = supabase();

  const { data: existing } = await sb.from('customers')
    .select('id, name, owner_notes, meta')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updates = {};

  try {
    // Rename — strip HTML, enforce length
    if (body.name !== undefined) {
      const cleaned = nameVal(body.name, { field: 'name', min: 1, max: 80, required: true });
      updates.name = cleaned;
      updates.meta = { ...(existing.meta || {}), renamed_by_owner: true };
    }

    // Append a note (from quick-note in chat)
    if (body.owner_notes_append) {
      const note = str(body.owner_notes_append, { field: 'owner_notes_append', max: 500, required: false });
      const ts = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const prev = existing.owner_notes ? existing.owner_notes.trim() + '\n' : '';
      updates.owner_notes = (`${prev}[${ts}] ${note}`).slice(0, 5000); // cap total notes length
    }

    // Direct note replace
    if (body.owner_notes !== undefined && !body.owner_notes_append) {
      updates.owner_notes = str(body.owner_notes, { field: 'owner_notes', max: 5000, required: false }) || null;
    }
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data: customer, error } = await sb.from('customers')
    .update(updates)
    .eq('id', params.id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ customer });
}