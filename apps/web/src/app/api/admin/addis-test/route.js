/**
 * GET /api/admin/addis-test
 * Sends a ping to the Addis AI API and returns latency + response.
 * Used by the admin Platform Health tab to verify connectivity.
 *
 * POST /api/admin/addis-test
 * Body: { message, targetLanguage? }
 * Sends a custom prompt to Addis AI and returns the full response.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { pingAddisAI, chatWithAddisAI } from '../../../../lib/server/addisAI';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function gate(request) {
  // Dual-auth: Telegram initData OR browser admin session cookie.
  return !!(await requireAdminRequest(request));
}

export async function GET(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const result = await pingAddisAI();
  return NextResponse.json(result);
}

export async function POST(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body = {};
  try { body = await request.json(); } catch {}

  const message = String(body.message || 'Hello, how are you?').slice(0, 2000);
  const result = await chatWithAddisAI(message, { targetLanguage: body.targetLanguage || 'am' });

  if (!result) return NextResponse.json({ ok: false, error: 'Addis AI returned no response' }, { status: 502 });
  return NextResponse.json({ ok: true, ...result });
}
