# MiniMe on Netlify

The app (`apps/web`) runs on Netlify with the config in `netlify.toml` at the
repo root. Nothing in the app is Netlify-only: the same code still deploys to
Vercel with `apps/web/vercel.json`.

## What is different from Vercel

| | Vercel | Netlify |
|---|---|---|
| Longest request | 300s (`maxDuration`) | **60s, fixed** |
| Crons | `crons` in `vercel.json` (daily only on Hobby) + two GitHub Actions workflows | one scheduled function, `apps/web/netlify/functions/cron-dispatch.mjs`, every 30 min |
| Production from `main` only | `VERCEL_ENV` / `VERCEL_GIT_COMMIT_REF` | `CONTEXT` / `BRANCH` (same guard in `next.config.js`) |

**The 60-second limit is the one that matters.** To live inside it:

- each LLM provider gets one short attempt (20s, Groq 15s) so the whole
  fallback chain fits — `src/lib/server/hostLimits.mjs`. Production runs
  Ollama Cloud first (`OLLAMA_ENABLED=true`); if its model regularly needs
  more than 20s, raise `AI_ATTEMPT_TIMEOUT_MS` (up to 40000) rather than let
  every reply fall through to Groq's small free quota;
- a webhook that still hasn't finished after 50s stops and DMs the owner
  ("I ran out of time answering Sara…") instead of being killed silently;
- cron routes get 60s each. With a handful of shops they finish; a route that
  loops over every business with an LLM call per item (`conversation-summaries`,
  `auto-learn`, `self-improve`, `weekly-digest`) can be cut short as the
  platform grows. Watch the function log for `cron-dispatch` lines.

## How it is deployed today

The live site is **`minime-app.netlify.app`** (Netlify project `minime-app`).
It was deployed by uploading this repository, not by linking it to GitHub, so
right now **nothing deploys by itself** — a push to `main` changes nothing on
Netlify until someone uploads again.

Because an upload carries no branch name, the "production builds from `main`
only" guard in `next.config.js` would refuse it. The project therefore has
`ALLOW_NON_MAIN_PRODUCTION=1` set, which switches the guard off.

To finish the setup (once, in the Netlify dashboard):

1. Project configuration → Build & deploy → Continuous deployment → link the
   GitHub repository, production branch `main`.
2. Delete the `ALLOW_NON_MAIN_PRODUCTION` variable. Git deploys report their
   branch, so the guard works again.

After that every push to `main` deploys, as it did on Vercel.

## First deploy

1. **Create the site** — Netlify → Add new project → Import from Git → this
   repository. Production branch `main`. Leave the build settings empty; they
   come from `netlify.toml` (base `apps/web`, `npm run build`, publish `.next`).
2. **Environment variables** — Project configuration → Environment variables.
   Copy every variable from the Vercel project (Vercel → Settings → Environment
   Variables). As of this migration that project has 26:

   - Telegram: `TELEGRAM_BOT_TOKEN`, `AGENT_BOT_WEBHOOK_SECRET`,
     `SEARCH_BOT_TOKEN`, `SEARCH_BOT_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_IDS`
   - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - Security: `ENCRYPTION_KEY`, `CRON_SECRET`
   - AI: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_ENABLED`,
     `OLLAMA_API_KEY`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `ADDIS_AI_API_KEY`,
     `HASAB_API_KEY`
   - Payments and others: `POLAR_ACCESS_TOKEN`, `POLAR_PRO_PRODUCT_ID`,
     `POLAR_WEBHOOK_SECRET`, `WHATCHIMP_API_KEY`, `WHATCHIMP_API_URL`
   - Address: `WEB_URL`, `NEXT_PUBLIC_APP_URL` — **do not copy these**; set
     both to the new address (`https://<site>.netlify.app`, no trailing slash).

   `ENCRYPTION_KEY` must be the **same value** as on Vercel — every shop's bot
   token in the database is encrypted with it. `CRON_SECRET`,
   `AGENT_BOT_WEBHOOK_SECRET` and `SEARCH_BOT_WEBHOOK_SECRET` should stay the
   same too.

   Vercel will not show the value of a variable marked Sensitive
   (`OLLAMA_API_KEY`, `ADDIS_AI_API_KEY`, the three `POLAR_*`); take those
   from where they were issued.

   Netlify allows about 4 KB of environment variables in total for functions.
   If a deploy fails on that, leave out what the code no longer reads
   (`HASAB_API_KEY`, `WHATCHIMP_*`).
3. **Deploy.** Any change to an environment variable needs a new deploy to
   take effect.

## Pointing the bots at the new address

Telegram still sends every update to the old host until told otherwise. After
the first successful deploy, with `$SITE` the new address and `$CRON_SECRET`
the secret:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/agent-bot/setup"
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/admin/reregister-webhooks"
```

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/search-bot/register"
```

The first moves @MiniMeAgentBot (shared bot and Secretary), the second every
shop's own bot, the third MiniMe Search. Then check with
`$SITE/api/cron/healthcheck` (same header).

Also update, wherever they were set by hand:

- **BotFather** — the Mini App / menu button URL of @MiniMeAgentBot, and
  `/setdomain` if Telegram Login is used on the web.
- **Meta** (WhatsApp / Instagram / Facebook) — webhook callback URL
  `$SITE/api/webhook/meta`.
- **Nango** — webhook URL `$SITE/api/webhook/nango`.
- **Chapa, Polar, verify-et** — callback / webhook URLs under `$SITE/api/payment/`.
- **Dimts** — the MiniMe base URL it calls.
- `apps/website` (the marketing page, a separate Vercel project) embeds `/demo`
  from this app; it now points at `minime-app.netlify.app` and needs its own
  redeploy.

## Crons

`cron-dispatch` must answer within a few seconds: Netlify's scheduler waits
about 15s for a scheduled function and then calls it again, up to three times,
which re-fires every cron due at that tick. It waits 6s for the routes and
returns; the routes carry on for up to 60s of their own.

`cron-dispatch` runs on the published production deploy only. Its table is
`apps/web/src/lib/cronSchedule.mjs`, which a test keeps equal to the `crons`
block in `vercel.json`, plus the two sub-daily jobs (delegation hourly,
pulse-alert every two hours) that Vercel Hobby could not schedule.

**Only one host may run the crons.** Both hosts talk to the same database, so
two schedulers mean every briefing, reminder and chase goes out twice.

- While on Netlify: keep the GitHub repository variable `CRON_BASE_URL` unset
  (the two workflows in `.github/workflows/` then skip themselves), and keep
  the Vercel project paused.
- Going back to Vercel: set `CRON_DISPATCH_DISABLED=1` on Netlify (or stop the
  site) **before** un-pausing Vercel, and set `CRON_BASE_URL` to the Vercel
  address so delegation and pulse-alert run from GitHub Actions again.
