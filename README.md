# MiniMe 🪞

AI-powered Telegram business assistant for Ethiopian small business owners.

## Setup

1. Copy `.env.example` to `.env` and fill in your API keys
2. Run schema in Supabase SQL Editor: `packages/db/schema.sql`, then everything in `packages/db/migrations/` in order
3. Install dependencies: `npm install` (in each app/package)
4. Start web: `npm run web`

## Structure

The live Telegram integration is entirely inside `apps/web` (Next.js API routes, deployed on Vercel) — there are **three** distinct bots:

- `apps/web/src/app/api/agent-bot` — the shared platform bot (@MiniMeAgentBot). Onboarding deep links, bot-token linking, and Telegram Business API "Secretary Mode" (replies as an owner's personal account).
- `apps/web/src/app/api/telegram/webhook/[secret]` — each business's own custom bot (a token they create via their own BotFather), the main buyer↔seller conversation surface. Registered from `apps/web/src/app/api/bot/link`.
- `apps/web/src/app/api/search-bot` — MiniMe Search, a separate cross-business product discovery bot with inline mode (`@MiniMeSearchBot <query>` in any chat).

Shared server logic lives in `apps/web/src/lib/server/` (`replyEngine.js`, `ownerCommands.js`, `telegramApi.js`, etc.) and `packages/db` (Supabase client and queries).

- `apps/bot` — an earlier Express + `node-telegram-bot-api` implementation, intended for a standalone Railway deployment. **Deprecated** — see `apps/bot/DEPRECATED.md`. Kept in the repo only until someone confirms no Railway service still points at it.
- `packages/shared` — Shared constants and prompts.

## License

Copyright (C) 2026 philipos2424

MiniMe is free software: you can redistribute it and/or modify it under the
terms of the **GNU Affero General Public License, version 3** as published by
the Free Software Foundation. See [LICENSE](LICENSE) for the full text.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

Note the network clause (AGPL §13): if you run a modified version of MiniMe as a
network service — including as a Telegram bot — you must offer its users access
to the corresponding modified source.
