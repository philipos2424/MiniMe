/**
 * GET /api/admin/hasab-test
 * Sends a ping to the Hasab AI API and returns latency + response.
 * Used by the admin Platform Health tab to verify connectivity.
 *
 * POST /api/admin/hasab-test
 * Body: { message, model?, temperature?, max_tokens? }
 * Sends a custom prompt to Hasab and returns the full response.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { pingHasab, chatWithHasab } from '../../../../lib/server/hasab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return false;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id);
}

export async function GET(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const result = await pingHasab();
  return NextResponse.json(result);
}

export async function POST(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body = {};
  try { body = await request.json(); } catch {}

  const message = String(body.message || 'Hello, how are you?').slice(0, 2000);
  const result = await chatWithHasab(message, {
    model: body.model || 'hasab-1-lite',
    temperature: Number(body.temperature ?? 0.7),
    max_tokens: Number(body.max_tokens ?? 2048),
    stream: false,
    tools: body.tools ?? null,
  });

  if (!result) return NextResponse.json({ ok: false, error: 'Hasab API returned no response' }, { status: 502 });
  return NextResponse.json({ ok: true, ...result });
}
