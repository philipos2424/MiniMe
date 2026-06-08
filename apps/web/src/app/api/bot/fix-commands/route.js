/**
 * POST /api/bot/fix-commands
 * Applies the correct command scope: owner-only commands visible to the owner,
 * empty list for all other chats (so customers never see /orders, /sales, etc.).
 * Called from Settings → Bot → "🔧 Fix commands" button.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER_COMMANDS = [
  { command: 'orders',    description: 'Pending orders & active jobs' },
  { command: 'sales',     description: 'Revenue summary (today / week / month)' },
  { command: 'stock',     description: 'Inventory levels & low-stock alerts' },
  { command: 'price',     description: 'Update a product price — /price Injera 18' },
  { command: 'restock',   description: 'Update stock — /restock Injera +50 or 100' },
  { command: 'customers', description: 'List your customers' },
  { command: 'dm',        description: 'DM a customer — /dm Sara your order is ready' },
  { command: 'advisor',   description: 'Ask the AI advisor anything' },
  { command: 'teach',     description: 'Teach MiniMe about your business' },
  { command: 'rule',      description: 'Add a behavior rule — /rule use emojis' },
  { command: 'rules',     description: 'List all behavior rules' },
  { command: 'knowledge', description: 'View & delete knowledge items' },
  { command: 'forget',    description: 'Delete a knowledge item by title' },
  { command: 'search',    description: 'Search products — /search leather bag' },
  { command: 'reminders', description: 'View pending reminders' },
  { command: 'discount',  description: 'Create promo code — /discount SUMMER20 20%' },
  { command: 'add',       description: 'Add new product — /add Injera 45 or /add Tibs 180 50' },
  { command: 'remove',    description: 'Hide product — /remove Injera' },
  { command: 'list',      description: 'Show all products with prices and stock' },
];

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!business.telegram_bot_token_enc) {
    return NextResponse.json({ error: 'no_bot_linked' }, { status: 400 });
  }

  let token;
  try { token = decrypt(business.telegram_bot_token_enc); }
  catch { return NextResponse.json({ error: 'decrypt_failed' }, { status: 500 }); }

  const BASE = 'https://api.telegram.org';

  // Step 1: Clear global (all_private_chats) command list so customers see nothing
  const clearRes = await fetch(`${BASE}/bot${token}/deleteMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: { type: 'all_private_chats' } }),
    signal: AbortSignal.timeout(8000),
  });
  const clearJ = await clearRes.json();
  if (!clearJ.ok) {
    return NextResponse.json({ error: `Telegram rejected command clear: ${clearJ.description}` }, { status: 502 });
  }

  // Step 2: Set commands visible only in the owner's chat
  const setRes = await fetch(`${BASE}/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: OWNER_COMMANDS,
      scope: { type: 'chat', chat_id: business.owner_telegram_id },
    }),
    signal: AbortSignal.timeout(8000),
  });
  const setJ = await setRes.json();
  if (!setJ.ok) {
    return NextResponse.json({ error: `Telegram rejected command set: ${setJ.description}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: 'Done — customers see no commands, you see everything.' });
}
