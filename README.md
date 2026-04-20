# MiniMe 🪞

AI-powered Telegram business assistant for Ethiopian small business owners.

## Setup

1. Copy `.env.example` to `.env` and fill in your API keys
2. Run schema in Supabase SQL Editor: `packages/db/schema.sql`
3. Install dependencies: `npm install` (in each app/package)
4. Start bot: `npm run bot:dev`
5. Start web: `npm run web`

## Structure

- `apps/bot` — Telegram bot (Railway)
- `apps/web` — Next.js dashboard (Vercel)
- `packages/shared` — Shared constants and prompts
- `packages/db` — Supabase client and queries
