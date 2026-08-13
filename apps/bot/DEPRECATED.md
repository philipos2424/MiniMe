# Deprecated

This Express + `node-telegram-bot-api` implementation predates the current
architecture. The live Telegram integration for MiniMe now runs entirely as
Next.js API routes inside `apps/web` — see the root `README.md`'s Structure
section for the three bots and where each is handled.

This directory is kept only because it may still back a Railway deployment.
**Before deleting it**, confirm no Railway service is pointed at a bot token
that still has its webhook set to this app (check via `getWebhookInfo` for
each business's token, or ask whoever manages the Railway project). Once
that's confirmed, this whole directory can be removed.
