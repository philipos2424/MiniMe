/**
 * POST /api/bot/link
 * Body: { token: "<bot token from @BotFather>", workspace_type: "personal" | "business" }
 * Auth: Telegram initData header (verified against PLATFORM bot token)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, create as createBusiness, update as updateBusiness, generateShopCode } from '../../../../lib/server/businesses';
import { encrypt, randomSecret } from '../../../../lib/server/crypto';
import { audit } from '../../../../lib/server/audit';
import { allowedUpdates, isPlatformBotToken } from '../../../../lib/server/telegramConfig';

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

    // ── CRITICAL guard: never let anyone link a MiniMe system bot ──────────
    // The shared @MiniMeAgentBot powers BOTH shared mode and ALL Secretary
    // connections. If its token were linked here as a "custom bot", we'd
    // re-point its webhook to this tenant's path and silence the whole
    // platform. (This is exactly the outage that happened once.) Reject it.
    if (isPlatformBotToken(token)) {
      return NextResponse.json({
        error: 'platform_token_not_allowed',
        detail: 'That is a MiniMe system bot token and cannot be linked. Create your own bot with @BotFather, or use Secretary Mode / shared mode instead.',
      }, { status: 400 });
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
          // Include business_* so a custom bot added as a Telegram Business
          // chatbot also drives Secretary Mode. See telegramConfig.js.
          allowed_updates: allowedUpdates(),
        }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.description || `setWebhook failed (${r.status})`);
    } catch (e) {
      return NextResponse.json({ error: 'set_webhook_failed', detail: e.message }, { status: 500 });
    }

    // Register owner-only commands scoped to the owner's chat.
    // IMPORTANT: We first DELETE any global 'all_private_chats' commands so
    // customers never see /orders, /sales, /stock etc. in their chat.
    // Then we set the same commands scoped only to the owner's Telegram ID.
    const ownerCommands = [
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
      { command: 'add',       description: 'Add new product — /add Injera 45' },
      { command: 'remove',    description: 'Hide a product — /remove Injera' },
      { command: 'list',      description: 'Show all products with prices' },
    ];
    // Step 1: Clear global commands so customers see an empty command list
    fetch(`https://api.telegram.org/bot${token}/deleteMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: { type: 'all_private_chats' } }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
    // Step 2: Set commands visible only to the owner
    if (tgUser?.id) {
      fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: ownerCommands,
          scope: { type: 'chat', chat_id: tgUser.id },
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }

    const updates = {
      telegram_bot_token_enc: enc,
      telegram_bot_username: botInfo.username,
      telegram_bot_id: botInfo.id,
      webhook_secret,
      bot_linked_at: new Date().toISOString(),
      bot_last_error: null,
      onboarding_completed: true,  // Mark complete so DashboardShell never re-routes
      brain_mode: true,
      trust_level: 2,
      bot_mode: 'custom',
    };
    // Ensure shop_code exists (for MiniMe Search deep links)
    if (!business.shop_code) updates.shop_code = generateShopCode();
    if (workspace_type && ['personal', 'business'].includes(workspace_type)) {
      updates.workspace_type = workspace_type;
    }
    const updated = await updateBusiness(business.id, updates);

    // Notify platform admin — onboarding fully complete
    const adminId = process.env.PLATFORM_ADMIN_TELEGRAM_ID;
    const platformToken = process.env.TELEGRAM_BOT_TOKEN;
    if (adminId && platformToken) {
      const ownerName = business.owner_name || tgUser.first_name || 'Unknown';
      const tgHandle = tgUser.username ? ` (@${tgUser.username})` : '';
      fetch(`https://api.telegram.org/bot${platformToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          parse_mode: 'Markdown',
          text: `✅ *Bot connected — onboarding complete!*\n\n🏪 *${business.name}*\n👤 ${ownerName}${tgHandle}\n🤖 @${botInfo.username}\n📂 ${business.category || 'uncategorised'}\n\n_They are now live and handling customer messages._`,
        }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => {});
    }

    await audit({
      business_id: business.id, actor_type: 'owner', actor_id: String(tgUser.id),
      action: 'bot.token_updated', resource_type: 'business', resource_id: business.id,
      metadata: { bot_username: botInfo.username, bot_id: botInfo.id }, request,
    });

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
