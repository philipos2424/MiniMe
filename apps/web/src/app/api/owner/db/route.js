/**
 * POST /api/owner/db
 *
 * Runs a validated query spec for the Mini App, scoped to the caller's own
 * business. The browser can't read these tables directly (RLS is on with no
 * policies, by design), so screens go through here via lib/owner-db.js.
 * See lib/ownerDbProtocol.mjs for the rules.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { validateSpec, scopeColumn, scopeInsertValues, stripSecrets } from '../../../../lib/ownerDbProtocol.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ data: null, error: { message: 'unauthorized' } }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ data: null, error: { message: 'no_business' } }, { status: 403 });

  let raw;
  try { raw = await request.json(); } catch { raw = null; }
  const v = validateSpec(raw);
  if (!v.ok) return NextResponse.json({ data: null, error: { message: v.error } }, { status: 400 });
  const spec = v.spec;

  const sb = supabase();
  const scope = scopeColumn(spec.table);
  let q = sb.from(spec.table);

  if (spec.op === 'select') q = q.select(spec.select || '*', spec.selectOpts || undefined);
  else if (spec.op === 'insert') q = q.insert(scopeInsertValues(spec.values, business.id));
  else if (spec.op === 'update') q = q.update(spec.values);
  else if (spec.op === 'delete') q = q.delete();

  // Return rows from writes so .insert().select().single() keeps working.
  if (spec.op !== 'select' && spec.select) q = q.select(spec.select);

  // The one rule that matters: every query is limited to this business.
  if (spec.op !== 'insert') q = q.eq(scope, business.id);

  for (const f of spec.filters) q = q[f.m](...f.a);
  for (const o of spec.order) q = q.order(o.col, o.opts);
  if (spec.range) q = q.range(spec.range[0], spec.range[1]);
  if (spec.limit) q = q.limit(spec.limit);
  if (spec.single === 'single') q = q.single();
  if (spec.single === 'maybe') q = q.maybeSingle();

  const { data, error, count } = await q;
  if (error) {
    console.warn('[owner/db]', spec.table, spec.op, error.message);
    return NextResponse.json({ data: null, error: { message: error.message, code: error.code } }, { status: 200 });
  }
  return NextResponse.json({ data: stripSecrets(data ?? null), error: null, count: count ?? null });
}
