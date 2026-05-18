/**
 * POST /api/settings/instructions
 * Body: { action: 'add'|'remove'|'list', rule?: string, index?: number }
 * Returns: { instructions: [{rule, added_at}] }
 *
 * Manages the owner's behavioral instructions — rules that tell the AI
 * how to talk to clients ("use emojis often", "always greet in Amharic", etc.)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import {
  saveOwnerInstruction,
  removeOwnerInstruction,
  listOwnerInstructions,
} from '../../../../lib/server/advisor';
import { str, num, oneOf, ValidationError, validationResponse } from '../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  let action, rule, index;
  try {
    action = oneOf(body.action, ['add', 'remove', 'list'], { field: 'action', required: false }) || 'list';
    if (body.rule !== undefined) {
      // Rules are owner-provided instructions for Alfred's behavior — allow natural language
      // but strip HTML tags and enforce reasonable length
      rule = str(body.rule, { field: 'rule', min: 1, max: 500, required: false, stripHtml: true });
    }
    if (body.index !== undefined) {
      index = num(body.index, { field: 'index', min: 0, max: 999, integer: true, required: false });
    }
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  try {
    if (action === 'add') {
      if (!rule) return NextResponse.json({ error: 'rule required' }, { status: 400 });
      const instructions = await saveOwnerInstruction(business.id, rule);
      return NextResponse.json({ instructions });
    }

    if (action === 'remove') {
      if (index === null || index === undefined) return NextResponse.json({ error: 'index required' }, { status: 400 });
      const instructions = await removeOwnerInstruction(business.id, index);
      return NextResponse.json({ instructions });
    }

    if (action === 'list' || !action) {
      const instructions = await listOwnerInstructions(business.id);
      return NextResponse.json({ instructions });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const instructions = await listOwnerInstructions(business.id);
    return NextResponse.json({ instructions });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
