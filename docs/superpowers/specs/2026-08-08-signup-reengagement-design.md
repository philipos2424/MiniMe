# Signup Re-engagement Engine — Design

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning

## Problem

People start signing up for MiniMe and never finish. Today almost nothing brings them back.

The only existing recovery is `/api/cron/onboarding-nudges`, which has two limits:

1. **It can't see the top of the funnel.** It queries the `businesses` table, so anyone who tapped *Sell* or opened the mini-app but never tapped "Let's go" has no row and is invisible to it.
2. **It says the same thing to everyone.** One fixed message — *"we just fixed a small bug on our end… tap Go Live again"* — regardless of whether the person stalled at naming their shop or at pasting a bot token. The bug-fix line is also a white lie that goes stale by the third send.

Beyond that, a person who *replies* to a nudge hits a dead end: they fall through to the unknown-user branch of the agent-bot webhook and receive a canned "open the mini-app" button.

## Goal

Bring stalled signups back by showing each person something specific and true about **their own** stalled setup, and by making the resulting conversation actually work.

Success is measured as: a nudged person advances at least one stage within 7 days of a send.

## Key insight

`onboarding_events` (migration 026) already records a whitelisted step per wizard screen, keyed by `telegram_id`, from `sell_cta_tapped` through `connected_*`. The furthest-reached step per `telegram_id`, joined to the `businesses` row when one exists, tells us exactly where any person stalled — across the whole funnel. `telegram_id` is also a DM handle.

Two known-wrong data paths are corrected as part of this work because stage detection depends on them:

- `tour_started`, `tour_finished`, `tour_skipped` are fired by the wizard but absent from `VALID_STEPS` in `/api/onboarding/track`, so they are silently dropped.
- `funnel_events` has no migration; every write to it silently no-ops. It is deleted along with the `logFunnel` helper, since `onboarding_events` is the real table.

## Stage ladder

A person's stage is their furthest-reached rung. Each rung gets a distinct artifact.

| Stage | Reached | Never reached | Artifact |
|---|---|---|---|
| **A1** Curious | `sell_cta_tapped` / `app_open` / `welcome` | no `businesses` row | Demand proof |
| **B1** Account, unnamed | `signup` | `shop_name_saved` | Demand proof + effort framing |
| **B2** Named | `shop_name_saved` | `customer_chat_finished` / `customer_chat_skipped` | A generated AI reply for their shop |
| **B3** Trained | `customer_chat_finished` / `_skipped` | `tryit_replied` | Profile card + catalog-grounded reply |
| **B4** Tested | `tryit_replied` | any `connect*` | "Ready and waiting" + learned-fact counts |
| **B5** Connecting | `connect_custom` | `connected_custom` | Stuck step + one-tap shared-mode escape |

Note that the `businesses` row is created at the "Let's go" tap (`/api/onboarding/signup`), with a placeholder name of the form `"{FirstName}'s Business"`. Stage B1 is therefore identified by a business row whose `shop_name_saved` event is absent — not by the absence of a row.

B5 is expected to convert best: those people completed every step and hit a BotFather wall. Offering shared mode removes the blocker instead of repeating an instruction that already failed.

## Architecture

A `reengage` module of focused units, orchestrated by a thin cron route. The existing `onboarding-nudges` route is replaced, but its proven semantics are carried over: opt-out check, cooldown, Telegram 403 → auto-opt-out, audit logging, and `?dry_run=1`.

```
/api/cron/reengagement/route.js     orchestration + auth only
  └── lib/server/reengage/
        stages.js      last-step-per-telegram_id → stage
        audience.js    eligibility, cooldown, caps, suppression
        artifacts.js   per-stage payload (demand proof, generated reply, counts)
        copy.js        bilingual templates, stage × variant
        send.js        Telegram send + history/attribution write
```

Each unit is independently testable: `stages.js` and `copy.js` are pure functions over plain data; `audience.js` takes a clock and returns a decision; `artifacts.js` and `send.js` are the only units that do I/O beyond querying.

### Data flow

1. Cron authorizes via `isCronAuthorized`.
2. `audience.js` loads candidates: all distinct `telegram_id`s in `onboarding_events` without a completed onboarding, left-joined to `businesses`.
3. `stages.js` assigns each candidate a stage from their event history.
4. `audience.js` applies eligibility, cooldown, suppression, and the daily cap; sorts oldest-first.
5. For each survivor: `artifacts.js` builds the payload, `copy.js` renders stage × variant × bilingual text, `send.js` delivers and records.
6. Summary is audited and returned.

## Cadence and volume

- **Per person:** at most 3 sends, on roughly day 1, day 3, and day 10 after stalling, then a permanent stop. The third send is always the exit question.
- **Globally:** a daily cap (default 50, env-tunable), oldest-first, so the historical backlog drains gradually rather than blasting the entire dormant list on first run.
- **Timing:** 17:00 UTC (20:00 EAT, evening) rather than the current 11:00 UTC (2pm EAT), when owners are serving customers.
- **Dry run:** `?dry_run=1` reports what would be sent, including resolved stage and variant per candidate, without sending.

## Messaging

All messages are bilingual — English then Amharic in a single DM. No language detection: the signal is sparse (Zone A candidates have no business row at all) and a bilingual message is never unreadable.

Two angles per stage, assigned per person and recorded:

- **Demand** — real marketplace numbers (unanswered searches, waitlist counts) drawn from `search_logs` and `search_waitlist`, as the existing `sell` CTA already does. A line whose number is zero is omitted entirely; we never quote "0 people".
- **Payoff** — show the work already done for them.

Drafted copy is in the appendix. Constraints on all copy:

- Markdown-safe (`parse_mode: 'Markdown'`).
- Every number interpolated from a live query, never invented.
- No claims about bugs or fixes that didn't happen.
- The Amharic requires a native-speaker review pass before first production send.

### Exit question

The third and final send, at any stage, asks why they stopped: four inline-keyboard chips — *Too complicated / No time / Too expensive / Just looking*. Taps are recorded against the send. This is the only mechanism that tells us why the funnel leaks.

## The reply path

A person who replies to a nudge must reach something useful. Today they hit the unknown-user branch and get a canned button.

The agent-bot webhook gains a branch, evaluated before the unknown-user fallback: if the sender has a recent re-engagement send on record, route the message to the agent brain with re-engagement context — their stage, their shop name if known, and the artifact they were shown. The brain answers questions and, where possible, advances setup conversationally rather than requiring a return to the mini-app. Reopening the app is the friction that lost them; requiring it to recover them repeats the losing move.

## Suppression and consent

A candidate is skipped when any of the following hold:

- `notification_prefs.owner_nudges.opted_out` is true (set by `STOP`, `/stop_nudges`, or a prior 403).
- The `telegram_id` belongs to a platform admin, consistent with the admin-exclusion work in `f9d61e4`.
- The candidate is a known test account.
- Three sends have already gone out.

`STOP` handling already works in the agent-bot webhook and needs no change; the copy's opt-out promise is honored today.

## Attribution

New table (migration `039_reengagement_sends.sql`):

```sql
CREATE TABLE reengagement_sends (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id  BIGINT NOT NULL,
  business_id  UUID,
  stage        TEXT NOT NULL,
  variant      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ DEFAULT now(),
  replied_at   TIMESTAMPTZ,
  exit_reason  TEXT,
  outcome      TEXT           -- null | 'advanced' | 'completed'
);
```

Indexed on `telegram_id` and `sent_at`. On each run, sends older than 7 days with a null `outcome` are checked: if the person's furthest stage has advanced since `sent_at`, `outcome` is set accordingly. This makes stage-by-stage and variant-by-variant conversion directly queryable, which is what makes copy iteration something other than guesswork.

## Error handling

- Telegram non-2xx: counted, logged, never throws; a 403 permanently opts the person out.
- Artifact generation failure: falls back to the stage's demand-angle copy, which needs no per-person generation. A person is never skipped because their artifact failed to build.
- `draftReply` (used for the B2 artifact) is the heaviest path in the system; the daily cap is what bounds its cost, and it runs under a timeout with the same fallback.
- A per-candidate failure never aborts the run.
- Missing `TELEGRAM_BOT_TOKEN` fails the run fast with a 500.

## Testing

Following the existing convention — `node --test` over `src/lib/server/__tests__/*.test.mjs`, pure logic extracted so it is testable without a database:

- `stages.test.mjs` — event history → stage, for every rung, including out-of-order events, empty history, and the B1 placeholder-name case.
- `audience.test.mjs` — cooldown boundaries, the 3-send cap, opt-out, admin suppression, daily-cap ordering.
- `copy.test.mjs` — every stage × variant renders; zero-valued demand lines are omitted; no unbalanced Markdown; both languages present.
- Attribution outcome logic — advanced vs. not, against synthetic event histories.

Manual verification before the first real send: `?dry_run=1` against production data, confirming stage distribution and per-candidate resolved copy look right.

## Out of scope

- A general campaign engine with authored segments and an admin UI. This is the thing to build on the third campaign, not the first.
- Email or SMS channels. Telegram is the only handle we reliably have.
- Incentives, discounts, or extended trials as re-engagement levers.

## Appendix — drafted copy

Values in `{braces}` are interpolated from live queries. Any line whose number
resolves to zero is omitted rather than rendered.

### A1 — Curious, never created an account (demand)

> 👋 Hi {first} — *{waiting} people* searched MiniMe for a shop like yours and found nobody.
>
> That's {waiting} customers with money ready and nowhere to spend it. Listing your shop is free and takes about a minute.
>
> ሰላም {first} — *{waiting} ሰዎች* እንደ እርስዎ ያለ ሱቅ በMiniMe ላይ ፈልገው አላገኙም። ሱቅዎን መዘርዘር ነጻ ነው፣ አንድ ደቂቃ ብቻ ይወስዳል።
>
> `[📱 List my shop — 1 min]`

**Variant — payoff.** Same structure, opener replaced with: "You looked at MiniMe but never started. Here's the whole thing in one line: **your customers message your Telegram, MiniMe answers them in your voice, 24/7, in Amharic and English.** You don't type anything."

### B2 — Shop named, never trained (payoff)

Carries a generated reply from `draftReply`.

> Hi {first} 👋 — curious what *{shop}* would sound like on MiniMe?
>
> A customer asks: _"{question}"_
> {shop} replies: _"{draft}"_
>
> MiniMe wrote that from nothing but your shop name. Two minutes of teaching and it'll know your prices, hours, and how you talk.
>
> ይሄንን የጻፈው የሱቅዎን ስም ብቻ አይቶ ነው። ሁለት ደቂቃ ካስተማሩት ዋጋዎን፣ ሰዓትዎን እና አነጋገርዎን ይማራል።
>
> `[🎓 Teach it — 2 min]`

### B4 — Trained and tested, never connected (payoff)

> {first}, your assistant is **ready and waiting.**
>
> It already knows {products} of your products and {facts} things about how *{shop}* works. It replies in your voice, in Amharic and English.
>
> Right now it's answering nobody. One tap turns it on.
>
> ረዳትዎ ተዘጋጅቷል — {products} ምርቶችዎን ያውቃል። አሁን ግን ማንንም እያገለገለ አይደለም። አንድ ንክኪ ብቻ።
>
> `[⚡ Turn it on]`

### B5 — Stalled at BotFather (escape hatch)

Highest expected conversion: these owners completed every step and hit a wall.

> {first} — you did all the hard work. You got stuck on the BotFather step, and honestly, that's the worst part of the whole setup.
>
> **You can skip it entirely.** Tap below and MiniMe answers your customers through @MiniMeAgentBot instead. No token, no BotFather, works right now.
>
> የBotFather ደረጃው ከባዱ ክፍል ነው — መዝለል ይችላሉ። MiniMe በ@MiniMeAgentBot በኩል ደንበኞችዎን ይመልሳል።
>
> `[⚡ Skip it — go live now]`  `[🔑 No, help me with the token]`

### Final send, any stage — exit question

> {first}, last message from me — I promise 🙏
>
> You started setting up *{shop}* but didn't finish, and I'd genuinely like to know why. One tap, and it helps me fix it for the next person.
>
> አንድ ንክኪ ብቻ — ለምን እንዳላጠናቀቁ ማወቅ እፈልጋለሁ።
>
> `[😵 Too complicated]` `[⏰ No time]` `[💸 Too expensive]` `[👀 Just looking]`

Stages B1 and B3 reuse the A1-demand and B2-payoff templates respectively, with
the shop name interpolated where known.
