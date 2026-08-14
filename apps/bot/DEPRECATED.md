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

## B2B negotiation code removed (2026-08-14)

The B2B negotiation subsystem here (`services/negotiation_engine.js`,
`transaction_manager.js`, `secretary_closer.js`, `b2b_research.js`,
`negotiation_history.js`, `manifest.js`, `handlers/research.js`,
`handlers/b2b.js`, and migrations `packages/db/migrations/035_b2b_network.sql`
/ `043_b2b_negotiations_fixes.sql`) has been deleted. It was already fully
orphaned: `transaction_manager.js` had zero importers anywhere in the repo, so
nothing ever advanced a `b2b_negotiations` row past `'negotiating'`; and
`handlers/research.js` / `handlers/command.js` failed `node --check` outright.
The live B2B/research pipeline is entirely in `apps/web` — see
`apps/web/src/lib/server/{research,b2b,researchTruth,b2bAudience,b2bAutonomy,
synergy,negotiationRules}.mjs/.js`.

Three ideas from this code were ported into the live path before deletion:
the Synergy Engine's "who should I sell to" inversion (→ `synergy.mjs`), the
deterministic no-LLM price-floor arithmetic (→ `negotiationRules.mjs`), and
the honest "no manifest" fallback labeling instinct (→ the Truth Guard in
`researchTruth.mjs`).

`services/lead_card.js` was deliberately kept — it's still imported by
`services/agent.js` for the general (non-B2B) trust-level lead-card approval
flow, which is a separate feature from the B2B negotiation code removed here.
