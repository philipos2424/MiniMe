/**
 * POST /api/bot/link
 * Body: { token: "<bot token from @BotFather>", workspace_type: "personal" | "business" }
 * Auth: Telegram initData header (verified against PLATFORM bot token)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, create as createBusiness, update as updateBusiness } from '../../../../lib/server/businesses';
import { encrypt, randomSecret } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const initData = request.headers.get('x-telegram-init-data');
    const valid = initData && verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const tgUser = parseTelegramUser(initData);
    if (!tgUser?.id) return NextResponse.json({ error: 'bad_init_data' }, { status: 401 });

    const { token, workspace_type } = await request.json();
    if (!token || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
      return NextResponse.json({ error: 'invalid_token_format' }, { status: 400 });
    }

    // --- Validate with Telegram ---
    let botInfo;
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.description || 'getMe returned not ok');
      botInfo = j.result;
    } catch (e) {
      return NextResponse.json({ error: 'token_rejected_by_telegram', detail: e.message }, { status: 400 });
    }

    // --- Resolve / create business ---
    let business = await findByOwnerTelegramId(tgUser.id);
    if (!business) {
      business = await createBusiness({
        owner_telegram_id: tgUser.id,
        owner_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || null,
        name: botInfo.first_name || `${tgUser.first_name || 'My'} Workspace`,
        workspace_type: ['personal', 'business'].includes(workspace_type) ? workspace_type : 'personal',
        onboarding_completed: false,
      });
    }
    if (!business) return NextResponse.json({ error: 'could_not_create_business' }, { status: 500 });

    // --- Encrypt + set webhook ---
    const enc = encrypt(token);
    const webhook_secret = business.webhook_secret || randomSecret(24);
    const baseUrl = (process.env.WEB_URL || `https://${request.headers.get('host')}`).replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/api/telegram/webhook/${webhook_secret}`;

    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhook_secret,
          drop_pending_updates: true,
          allowed_updates: ['message', 'edited_message', 'callback_query', 'pre_checkout_query'],
        }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.description || `setWebhook failed (${r.status})`);
    } catch (e) {
      return NextResponse.json({ error: 'set_webhook_failed', detail: e.message }, { status: 500 });
    }

    // Register bot commands so Telegram shows autocomplete hints in the chat input.
    // Fire-and-forget — don't block the response on this.
    fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
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
          { command: 'reminders', description: 'View pending reminders' },
        ],
        scope: { type: 'all_private_chats' },
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {}); // ignore failures — non-critical

    const updates = {
      telegram_bot_token_enc: enc,
      telegram_bot_username: botInfo.username,
      telegram_bot_id: botInfo.id,
      webhook_secret,
      bot_linked_at: new Date().toISOString(),
      bot_last_error: null,
      brain_mode: true,     // Enable autonomous agent by default
      trust_level: 2,       // TRUSTED — auto-sends routine replies at ≥70% confidence
    };
    if (workspace_type && ['personal', 'business'].includes(workspace_type)) {
      updates.workspace_type = workspace_type;
    }
    const updated = await updateBusiness(business.id, updates);

    return NextResponse.json({
      ok: true,
      bot: { username: botInfo.username, first_name: botInfo.first_name, id: botInfo.id },
      workspace_type: updated?.workspace_type || business.workspace_type || 'personal',
      webhook_url: webhookUrl,
    });
  } catch (e) {
    console.error('/api/bot/link error:', e);
    return NextResponse.json({ error: 'internal', detail: e.message }, { status: 500 });
  }
}
