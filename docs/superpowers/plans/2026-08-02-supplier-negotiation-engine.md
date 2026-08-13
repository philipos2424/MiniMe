# Supplier Negotiation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current one-shot "negotiate" button (which drafts a counter-offer and dead-ends) into a stateful negotiation loop with owner-selectable autonomy (draft / auto / full), round tracking, deterministic accept/counter/walk-away logic, and a 48h timeout escalation.

**Architecture:** Negotiation state lives entirely on the existing `agent_tasks` row (`payload.negotiation`), so no new table is needed. A new pure-ish service module `negotiation.js` owns the state machine; `evaluateQuote` is a deterministic function with no LLM call (round/target/walk-away math only) — the LLM is used exclusively inside `draftCounter` to word a counter-offer, never to decide accept/counter/walk. Four existing bot files (`agent.js`, `supplierReply.js`, `callback.js`, `scheduler.js`) are rewired to hand control to `negotiation.js` instead of dead-ending after outreach. A new slash command exposes mode + limits config, gated by `trust_level`.

**Tech Stack:** Node.js (CommonJS) bot app (`apps/bot`), Supabase Postgres, `node-telegram-bot-api`, the existing `aiClient.js` OpenAI-compatible proxy (Groq/Gemini/Ollama failover). Tests via built-in `node --test` (ESM `.mjs` files under root `tests/`).

## Global Constraints

- `evaluateQuote` must be deterministic — no LLM call, ever. The model only words text (`draftCounter`); it never decides accept/counter/walk-away.
- Autonomy gating: `'auto'` mode requires `business.trust_level >= 2`; `'full'` requires `business.trust_level >= 3`. Enforced both when the owner tries to set the mode (`/negotiation` command) and defensively inside the dispatcher (`handleSupplierQuote`) in case `trust_level` drops after the mode was set.
- All DB writes to `agent_tasks` go through `packages/db/queries/tasks.js` (`updateTask`, `addStep`, `addDecisionLog`) — do not query `agent_tasks` directly with a bare `supabase.from(...)` (an existing inconsistency in `supplierReply.js`'s `findLatestReorderTask` is a pre-existing wart, not a pattern to extend).
- Postgres `CHECK` constraints cannot be altered in place — every constraint change is `ALTER TABLE ... DROP CONSTRAINT ...` then re-add with the full widened list, additive only, following the exact style of `packages/db/migrations/029_delegation.sql` through `032_subscriptions_and_ai_usage.sql` (header comment explaining intent, `IF NOT EXISTS`/`IF EXISTS` guards, a note that DDL must be applied manually in the Supabase SQL editor since the service-role key can't run DDL).
- New migration file: `packages/db/migrations/033_negotiation.sql` (032 is currently the highest-numbered file) — mirror every DDL change into `packages/db/schema.sql` in the same task so a fresh environment built from `schema.sql` alone matches one built from migrations.
- Currency/amount fields follow existing convention: `DECIMAL(12,2)`, 3-letter currency code, default `'ETB'`.
- Telegram sends always go through `bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup?: {...} })` — no other wrapper exists in this codebase.
- LLM calls go through `require('./aiClient').openai.chat.completions.create({ model, messages, response_format?, max_tokens, temperature })`. **Important:** whatever `model` string is passed is silently overwritten by the active provider's default model inside the proxy (`aiClient.js:86`) — pass any placeholder model name, it has no real effect, but keep passing one to match every existing call site's shape.
- Branch: `claude/minime-future-evolution-2f9e3r`. Create it from `main` before Task 1. Commit after every task; push and open a **draft** PR after the final task (do not mark it ready for review).

---

## File Structure

- **Create:** `packages/db/migrations/033_negotiation.sql` — widens `agent_tasks.status` CHECK (+`negotiating`, +`executing`), widens `agent_tasks.type` CHECK (+`negotiation_timeout`), adds `businesses.negotiation_mode` (`'draft'|'auto'|'full'`, default `'draft'`, CHECK), adds a partial index on negotiating tasks.
- **Modify:** `packages/db/schema.sql` — mirror the same three DDL changes into the baseline `CREATE TABLE`/CHECK definitions.
- **Modify:** `apps/bot/src/services/ai.js` — add `makeAgentDecision(prompt)` (currently imported by `agent.js:5` but never defined — a live bug that breaks `checkInventory`/`checkPaymentFollowups` today).
- **Modify:** `apps/bot/src/services/notification.js` — add `notifyOwnerTask(bot, business, task)` (currently imported by `agent.js:7` but never defined — same class of live bug).
- **Modify:** `packages/shared/prompts.js` — add `agentDecisionPrompt(business, taskType, context)` (currently imported by `agent.js:6` but never defined — discovered during exploration, not in the original spec, but `checkInventory` cannot reach line 39 without it, so `supply_reorder` task creation — the entry point this whole feature depends on — is dead code without this fix).
- **Create:** `apps/bot/src/services/negotiation.js` — the negotiation state machine: `startNegotiation`, `evaluateQuote`, `draftCounter`, `sendCounter`, `acceptDeal`, `walkAway`, `handleSupplierQuote`, `notifyOwner`.
- **Modify:** `apps/bot/src/services/agent.js` — `supply_reorder` branch (`~L190-334`): after dispatch, call `negotiation.startNegotiation` instead of marking `'completed'`; fix the pending-task dedupe check (`~L32-34`) to also treat `'negotiating'`/`'awaiting_approval'` as "already in flight".
- **Modify:** `apps/bot/src/services/supplierReply.js` (`~L126-138`): if the task's status is `'negotiating'`, route the parsed quote to `negotiation.handleSupplierQuote` instead of the current owner-DM-with-buttons path.
- **Modify:** `apps/bot/src/handlers/callback.js` (`~L86-137`): rework `quote_negotiate_` to call `negotiation.draftCounter` and store `pending_draft` + show `neg_send_`/`neg_walk_` buttons (instead of just DMing a throwaway draft); add `neg_send_`, `neg_walk_`, `neg_accept_`, `negmode_*` handlers; make `quote_approve_` call `negotiation.acceptDeal` when the task is `'negotiating'` so the supplier gets a confirmation too.
- **Modify:** `apps/bot/src/handlers/command.js`: new `case '/negotiation':` block (mode show/set + `limits <target%> <rounds> <walkaway%>` subcommand), one new line in `/help`.
- **Modify:** `apps/bot/src/services/scheduler.js`: add `'negotiation_timeout'` to the `fireDueTasks` type filter (`~L87`) and its dispatch (`~L142`) so a scheduled timeout task actually fires; on fire, nudge the supplier once via `negotiation`, then escalate to the owner.
- **Create:** `tests/negotiation-evaluate.test.mjs` — full matrix test of `evaluateQuote`.

---

## Task 1: Migration 033 + schema.sql mirror

**Files:**
- Create: `packages/db/migrations/033_negotiation.sql`
- Modify: `packages/db/schema.sql:175-206` (`agent_tasks`), `packages/db/schema.sql:11-48` (`businesses`)

**Interfaces:**
- Produces: `agent_tasks.status` now accepts `'negotiating'` and `'executing'`; `agent_tasks.type` now accepts `'negotiation_timeout'`; `businesses.negotiation_mode` column (`text`, default `'draft'`, one of `'draft'|'auto'|'full'`). All later tasks depend on these three being live in the DB before any code path sets them.

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/033_negotiation.sql`:

```sql
-- 033_negotiation.sql — Supplier Negotiation Engine.
--
-- Gives agent_tasks a real "in a live negotiation" state instead of dead-ending
-- right after outreach, plus a scheduled-timeout type so a stalled negotiation
-- escalates to the owner instead of silently rotting.
--
-- Also legitimizes 'executing', which apps/bot/src/services/scheduler.js already
-- writes to agent_tasks.status on every fired task (scheduler.js:106) — that
-- write has been silently violating the live CHECK constraint since scheduler
-- shipped. Additive only. Apply in the Supabase SQL editor — DDL can't run
-- through the service-role key without a PAT.

-- ── 1. agent_tasks.status: add 'negotiating', 'executing' ──────────────────
alter table agent_tasks drop constraint if exists agent_tasks_status_check;
alter table agent_tasks add constraint agent_tasks_status_check check (status in (
  'pending', 'awaiting_approval', 'approved', 'in_progress',
  'completed', 'failed', 'cancelled', 'blocked',
  'negotiating', 'executing'
));

-- ── 2. agent_tasks.type: add 'negotiation_timeout' ──────────────────────────
alter table agent_tasks drop constraint if exists agent_tasks_type_check;
alter table agent_tasks add constraint agent_tasks_type_check check (type in (
  'supply_reorder', 'delivery_schedule', 'payment_followup',
  'inventory_check', 'customer_followup', 'price_update',
  'reminder', 'scheduled_message', 'followup', 'broadcast', 'briefing',
  'owner_action', 'delegated_task',
  'negotiation_timeout'
));

-- ── 3. businesses.negotiation_mode ──────────────────────────────────────────
alter table businesses
  add column if not exists negotiation_mode text default 'draft';

alter table businesses drop constraint if exists businesses_negotiation_mode_check;
alter table businesses add constraint businesses_negotiation_mode_check
  check (negotiation_mode in ('draft', 'auto', 'full'));

-- ── 4. Fast lookup for the scheduler / dashboards ───────────────────────────
create index if not exists idx_agent_tasks_negotiating
  on agent_tasks(business_id) where status = 'negotiating';
```

- [ ] **Step 2: Mirror into schema.sql**

In `packages/db/schema.sql`, update the `agent_tasks` CHECK constraints (lines 178-187) to:

```sql
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'supply_reorder', 'delivery_schedule', 'payment_followup',
    'inventory_check', 'customer_followup', 'price_update',
    'reminder', 'scheduled_message', 'followup', 'broadcast', 'briefing',
    'owner_action', 'delegated_task',
    'negotiation_timeout'
  )),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
    'pending', 'awaiting_approval', 'approved', 'in_progress',
    'completed', 'failed', 'cancelled', 'blocked',
    'negotiating', 'executing'
  )),
```

And add to the `businesses` table (after line 30, `trust_level`):

```sql
  negotiation_mode VARCHAR(10) DEFAULT 'draft' CHECK (negotiation_mode IN ('draft', 'auto', 'full')),
```

Then append the `idx_agent_tasks_negotiating` index next to the other `agent_tasks` indexes (near line 285).

- [ ] **Step 3: Verify SQL is well-formed**

Run: `node -e "require('fs').readFileSync('packages/db/migrations/033_negotiation.sql','utf8')"` (sanity file-read; there is no local Postgres in this repo to actually execute DDL against — the repo's convention, per every prior migration's header comment, is manual apply via the Supabase SQL editor). Visually diff the constraint lists between the migration and `schema.sql` to confirm they're identical.

- [ ] **Step 4: Commit**

```bash
git checkout -b claude/minime-future-evolution-2f9e3r
git add packages/db/migrations/033_negotiation.sql packages/db/schema.sql
git commit -m "feat(negotiation): add negotiating/executing status, negotiation_timeout type, businesses.negotiation_mode"
```

---

## Task 2: Fix broken agent.js dependencies

**Files:**
- Modify: `apps/bot/src/services/ai.js` (add `makeAgentDecision`)
- Modify: `apps/bot/src/services/notification.js` (add `notifyOwnerTask`)
- Modify: `packages/shared/prompts.js` (add `agentDecisionPrompt`)

**Interfaces:**
- Consumes: `openai`, `resolveModel` from `./aiClient` (already imported in `ai.js`).
- Produces: `makeAgentDecision(prompt: string) → Promise<{decision: string, reasoning: string, confidence: number}>` — called as `agent.js:39`. `notifyOwnerTask(bot, business, task) → Promise<void>` — called as `agent.js:57,88`. `agentDecisionPrompt(business, taskType: string, context: object) → string` — called as `agent.js:38`. These three are consumed as-is by Task 5; do not change their call signatures.

This task fixes three functions that are `require()`'d but never defined anywhere in the repo — `checkInventory` and `checkPaymentFollowups` throw `TypeError: ... is not a function` the moment they run today, so no `supply_reorder` task has ever been created via this path in production. This must land before Task 5 (which extends `checkInventory`'s caller) or the whole feature has nothing to build on.

- [ ] **Step 1: Add `agentDecisionPrompt` to `packages/shared/prompts.js`**

```js
const getClassificationPrompt = (primaryLang, codeSwitch, formality, emojiUsage, voiceProfile) => {
  return `You classify customer messages for Ethiopian businesses on Telegram.

- Target Persona: AI Secretary
- Authority Level: ${voiceProfile?.authorityLevel || 'Standard'}

🇪🇹 COMMUNICATION STYLE
- Primary language: ${primaryLang === 'am' ? 'Amharic in Geez script (ፊደል)' : primaryLang === 'en' ? 'English' : 'Amharic-English mix'}
- Code-switch style: ${codeSwitch}
- Tone: ${formality <= 2 ? 'Casual' : 'Professional'}
- Emojis: ${emojiUsage}`;
};

const agentDecisionPrompt = (business, taskType, context) => {
  return `You are an autonomous business-operations agent for "${business.name}".
Decide what to do about this ${taskType.replace('_', ' ')} situation and return ONLY a valid JSON object:
{
  "decision": "one short sentence — what action to take",
  "reasoning": "one short sentence — why",
  "confidence": 0.0-1.0
}

Context:
${JSON.stringify(context, null, 2)}`;
};

module.exports = {
  getClassificationPrompt,
  agentDecisionPrompt,
};
```

- [ ] **Step 2: Add `makeAgentDecision` to `apps/bot/src/services/ai.js`**

Insert after `extractCustomerFacts` (before the final `module.exports`), following the exact `json_object` + try/catch-with-safe-default pattern every other function in this file already uses:

```js
async function makeAgentDecision(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: resolveModel('llama-3.1-8b-instant'),
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.3,
    });
    const result = JSON.parse(response.choices[0].message.content);
    return {
      decision: result.decision || 'Proceed with default action',
      reasoning: result.reasoning || 'No specific reasoning provided',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
    };
  } catch (error) {
    console.error('makeAgentDecision error:', error.message);
    return { decision: 'Proceed with default action', reasoning: 'AI decision failed, using default', confidence: 0.3 };
  }
}
```

And update the exports block:

```js
module.exports = {
  detectIntent,
  selectModel,
  generateReply,
  analyzeVoiceProfile,
  extractTasks,
  extractCustomerFacts,
  makeAgentDecision,
};
```

- [ ] **Step 3: Add `notifyOwnerTask` to `apps/bot/src/services/notification.js`**

Insert after `notifyOwnerSummary`, following the exact `if (!business.owner_private_chat_id) return;` + try/catch pattern every sibling function uses:

```js
async function notifyOwnerTask(bot, business, task) {
  try {
    if (!business.owner_private_chat_id) return;
    const urgencyEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[task.urgency] || '🟡';
    const text = `${urgencyEmoji} *New task: ${task.title}*\n\n` +
                 `${task.description || ''}\n\n` +
                 `_Type: ${task.type.replace('_', ' ')}_` +
                 (task.estimated_amount ? `\n_Estimated: ${task.estimated_amount} ${task.currency || 'ETB'}_` : '');
    await bot.sendMessage(business.owner_private_chat_id, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('notifyOwnerTask error:', e.message);
  }
}
```

And update the exports block:

```js
module.exports = {
  notifyOwnerDraft,
  notifyOwnerAutoSent,
  notifyOwnerNewMessage,
  notifyOwnerSummary,
  notifyOwnerTask,
};
```

- [ ] **Step 4: Syntax-check all three files**

Run: `node --check apps/bot/src/services/ai.js && node --check apps/bot/src/services/notification.js && node --check packages/shared/prompts.js`
Expected: no output (success) from all three.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/ai.js apps/bot/src/services/notification.js packages/shared/prompts.js
git commit -m "fix(agent): define makeAgentDecision, notifyOwnerTask, agentDecisionPrompt (were imported but never defined, breaking checkInventory/checkPaymentFollowups)"
```

---

## Task 3: `negotiation.js` — deterministic core (`evaluateQuote`)

**Files:**
- Create: `apps/bot/src/services/negotiation.js` (this task: `evaluateQuote` only — the rest is added in Task 4)
- Test: `tests/negotiation-evaluate.test.mjs`

**Interfaces:**
- Produces: `evaluateQuote(negotiation: NegotiationState, quote: {unit_price: number, currency?: string}) → 'accept'|'counter'|'walk_away'|'escalate'`, where `NegotiationState = { round: number, max_rounds: number, target_price: number, walk_away_price: number }`. Task 4's `handleSupplierQuote` calls this directly; Task 8's `/negotiation limits` command determines what values populate `target_price`/`walk_away_price`/`max_rounds` when a negotiation starts (Task 4's `startNegotiation`).

Decision rule (buyer's perspective — MiniMe is negotiating a purchase price down):
- `quote.unit_price <= negotiation.target_price` → `'accept'` (already at or better than target).
- `quote.unit_price > negotiation.walk_away_price` → `'walk_away'` (worse than the ceiling the owner set).
- Otherwise (between target and walk-away): if `negotiation.round >= negotiation.max_rounds` → `'escalate'` (out of rounds, still not good enough — owner decides manually rather than an automatic walk-away, since the quote is still within the acceptable band). Otherwise → `'counter'`.

- [ ] **Step 1: Write the failing test**

Create `tests/negotiation-evaluate.test.mjs`:

```js
/**
 * Run: node --test tests/negotiation-evaluate.test.mjs
 * evaluateQuote is the deterministic accept/counter/walk_away/escalate gate —
 * it must never call an LLM. This is a pure function of round/target/walk-away math.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuote } from '../apps/bot/src/services/negotiation.js';

const base = { round: 0, max_rounds: 3, target_price: 100, walk_away_price: 130 };

test('quote at or below target → accept', () => {
  assert.equal(evaluateQuote(base, { unit_price: 100 }), 'accept');
  assert.equal(evaluateQuote(base, { unit_price: 90 }), 'accept');
});

test('quote above walk-away price → walk_away', () => {
  assert.equal(evaluateQuote(base, { unit_price: 131 }), 'walk_away');
  assert.equal(evaluateQuote(base, { unit_price: 500 }), 'walk_away');
});

test('quote between target and walk-away, rounds remaining → counter', () => {
  assert.equal(evaluateQuote({ ...base, round: 0 }, { unit_price: 115 }), 'counter');
  assert.equal(evaluateQuote({ ...base, round: 2 }, { unit_price: 115 }), 'counter');
});

test('quote between target and walk-away, final round reached → escalate', () => {
  assert.equal(evaluateQuote({ ...base, round: 3 }, { unit_price: 115 }), 'escalate');
  assert.equal(evaluateQuote({ ...base, round: 4 }, { unit_price: 129 }), 'escalate');
});

test('boundary: exactly at walk_away_price is still acceptable-band, not walk_away', () => {
  assert.equal(evaluateQuote({ ...base, round: 0 }, { unit_price: 130 }), 'counter');
});

test('boundary: exactly at target_price accepts even on the final round', () => {
  assert.equal(evaluateQuote({ ...base, round: 3 }, { unit_price: 100 }), 'accept');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/negotiation-evaluate.test.mjs`
Expected: FAIL — `apps/bot/src/services/negotiation.js` does not exist yet (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/bot/src/services/negotiation.js`:

```js
/**
 * Deterministic accept/counter/walk_away/escalate gate for supplier negotiations.
 * NEVER calls an LLM — round/target/walk-away math only. The LLM is used
 * exclusively in draftCounter() to word a message; it never decides outcomes.
 */
function evaluateQuote(negotiation, quote) {
  const price = Number(quote.unit_price);
  if (price <= negotiation.target_price) return 'accept';
  if (price > negotiation.walk_away_price) return 'walk_away';
  if (negotiation.round >= negotiation.max_rounds) return 'escalate';
  return 'counter';
}

module.exports = { evaluateQuote };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/negotiation-evaluate.test.mjs`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/negotiation.js tests/negotiation-evaluate.test.mjs
git commit -m "feat(negotiation): deterministic evaluateQuote gate + test matrix"
```

---

## Task 4: `negotiation.js` — state machine (LLM + DB + Telegram wiring)

**Files:**
- Modify: `apps/bot/src/services/negotiation.js` (add everything except `evaluateQuote`, already done)

**Interfaces:**
- Consumes: `evaluateQuote` (Task 3, same file); `create`, `findById`, `updateTask`, `addStep`, `addDecisionLog` from `packages/db/queries/tasks.js`; `openai`, `resolveModel` from `./aiClient`; `createReminder`-style scheduling — actually uses `updateTask` with `scheduled_at`/`status:'scheduled'` directly (Task 9 wires the scheduler to pick these up).
- Produces (consumed by Task 5-7): `startNegotiation(bot, task, business, supplier) → Promise<void>`, `draftCounter(task, business, supplier) → Promise<string>` (returns the drafted message text, does NOT send it), `sendCounter(bot, task, business, supplier, draftText) → Promise<void>`, `acceptDeal(bot, task, business, supplier) → Promise<void>`, `walkAway(bot, task, business, supplier, reason?: string) → Promise<void>`, `handleSupplierQuote(bot, task, business, supplier, quote) → Promise<void>` (the mode-aware dispatcher — this is what Task 6 calls), `notifyOwner(bot, business, task, event: string, details: object) → Promise<void>`.

State shape stored at `task.payload.negotiation`:
```js
{
  mode: 'draft'|'auto'|'full',       // snapshot of business.negotiation_mode at start
  round: 0,
  max_rounds: 3,
  target_price: number,
  walk_away_price: number,
  currency: 'ETB',
  quantity: number,
  history: [{ round, from: 'supplier'|'us', unit_price, message, at }],
  pending_draft: null | { text: string, drafted_at: string },
  last_activity_at: string,           // ISO — used by the 48h timeout
  outcome: null | 'accepted'|'walked_away'|'escalated',
}
```

- [ ] **Step 1: Write the failing tests**

Append to `tests/negotiation-evaluate.test.mjs` (same file — these exercise the dispatcher's mode-aware branching, still deterministic given a fake `bot`/`bot.sendMessage` spy and a stubbed `draftCounter`... but `draftCounter` calls the real LLM proxy. To keep this test free of network calls, test `handleSupplierQuote`'s *branching* by injecting a task whose evaluated outcome is `'accept'` or `'walk_away'` — these two paths never call `draftCounter`/the LLM at all, so they're safe to test end-to-end):

```js
test('handleSupplierQuote: accept path calls acceptDeal, never touches the LLM', async () => {
  const { handleSupplierQuote } = await import('../apps/bot/src/services/negotiation.js');
  const sent = [];
  const fakeBot = { sendMessage: async (chatId, text) => { sent.push({ chatId, text }); } };
  const task = {
    id: 't1', business_id: 'b1',
    payload: { negotiation: { mode: 'draft', round: 0, max_rounds: 3, target_price: 100, walk_away_price: 130, history: [] } },
  };
  const business = { owner_private_chat_id: 999, name: 'Test Biz' };
  const supplier = { name: 'Acme', contact_telegram: 555 };
  await handleSupplierQuote(fakeBot, task, business, supplier, { unit_price: 90, currency: 'ETB' });
  assert.ok(sent.some(s => /accept/i.test(s.text) || /approved/i.test(s.text) || /deal/i.test(s.text)));
});

test('handleSupplierQuote: walk_away path notifies owner without an LLM call', async () => {
  const { handleSupplierQuote } = await import('../apps/bot/src/services/negotiation.js');
  const sent = [];
  const fakeBot = { sendMessage: async (chatId, text) => { sent.push({ chatId, text }); } };
  const task = {
    id: 't2', business_id: 'b1',
    payload: { negotiation: { mode: 'draft', round: 1, max_rounds: 3, target_price: 100, walk_away_price: 130, history: [] } },
  };
  const business = { owner_private_chat_id: 999, name: 'Test Biz' };
  const supplier = { name: 'Acme', contact_telegram: 555 };
  await handleSupplierQuote(fakeBot, task, business, supplier, { unit_price: 500, currency: 'ETB' });
  assert.ok(sent.some(s => /walk/i.test(s.text)));
});
```

These tests import the real `packages/db/queries/tasks.js`, which requires a live `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` at `require`-time (`packages/db/client.js:4-7`). Since CI/local test runs may not have these set, `acceptDeal`/`walkAway` must not hard-crash if the DB write fails — wrap the `updateTask`/`addStep`/`addDecisionLog` calls in try/catch (matching every other service file's convention) so the Telegram-send and owner-notify side effects (what these tests assert on) still happen even if persistence throws in a test environment. Document this in a comment at the top of `negotiation.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/negotiation-evaluate.test.mjs`
Expected: FAIL — `handleSupplierQuote`/`acceptDeal`/`walkAway` are not exported yet.

- [ ] **Step 3: Write the implementation**

Replace the full content of `apps/bot/src/services/negotiation.js` with:

```js
/**
 * Supplier Negotiation Engine — stateful negotiation loop layered on agent_tasks.
 *
 * evaluateQuote() is deterministic (round/target/walk-away math, no LLM).
 * draftCounter() is the ONLY function that calls an LLM, and only to word a
 * message — the model never decides accept/counter/walk_away.
 *
 * DB writes are best-effort: if packages/db is unreachable (e.g. missing env
 * vars in a test run), Telegram sends and owner notifications still happen —
 * persistence failures must never block the negotiation from progressing in
 * the chat itself.
 */
const { updateTask, addStep, addDecisionLog } = require('../../../../packages/db/queries/tasks');
const { openai, resolveModel } = require('./aiClient');

function evaluateQuote(negotiation, quote) {
  const price = Number(quote.unit_price);
  if (price <= negotiation.target_price) return 'accept';
  if (price > negotiation.walk_away_price) return 'walk_away';
  if (negotiation.round >= negotiation.max_rounds) return 'escalate';
  return 'counter';
}

async function safeUpdateTask(taskId, patch) {
  try { await updateTask(taskId, patch); } catch (e) { console.error('negotiation: updateTask failed:', e.message); }
}
async function safeAddStep(taskId, step) {
  try { await addStep(taskId, step); } catch (e) { console.error('negotiation: addStep failed:', e.message); }
}
async function safeAddDecisionLog(taskId, entry) {
  try { await addDecisionLog(taskId, entry); } catch (e) { console.error('negotiation: addDecisionLog failed:', e.message); }
}

async function notifyOwner(bot, business, task, event, details = {}) {
  if (!business.owner_private_chat_id) return;
  const neg = task.payload?.negotiation || {};
  const labels = {
    counter_sent: `↩️ *Counter-offer sent* to ${task.supplier_name || 'supplier'} (round ${neg.round}/${neg.max_rounds})\n\n${details.text || ''}`,
    round_summary: `📊 *Round ${neg.round}/${neg.max_rounds}* with ${task.supplier_name || 'supplier'}: ${details.text || ''}`,
    accepted: `✅ *Deal reached* with ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
    walked_away: `🚫 *Walked away* from ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
    escalated: `⚠️ *Needs your decision* — ${task.supplier_name || 'supplier'} won't move further.\n\n${details.text || ''}`,
    final_report: `📋 *Negotiation complete* with ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
    draft_ready: `💬 *Draft ready for your approval* — ${task.supplier_name || 'supplier'}\n\n${details.text || ''}`,
  };
  const text = labels[event] || `${event}: ${details.text || ''}`;
  const opts = { parse_mode: 'Markdown' };
  if (details.buttons) opts.reply_markup = { inline_keyboard: details.buttons };
  await bot.sendMessage(business.owner_private_chat_id, text, opts);
}

async function startNegotiation(bot, task, business, supplier) {
  const limits = business.notification_prefs?.negotiation_limits || {};
  const askPrice = task.payload?.product?.cost_price || task.estimated_amount || 0;
  const discountPct = limits.discount_target_pct ?? 10;
  const walkAwayPct = limits.walk_away_pct ?? 25;
  const negotiation = {
    mode: business.negotiation_mode || 'draft',
    round: 0,
    max_rounds: limits.max_rounds ?? 3,
    target_price: Math.round(askPrice * (1 - discountPct / 100) * 100) / 100,
    walk_away_price: Math.round(askPrice * (1 + walkAwayPct / 100) * 100) / 100,
    currency: task.currency || 'ETB',
    quantity: task.payload?.product?.reorder_quantity || 50,
    history: [],
    pending_draft: null,
    last_activity_at: new Date().toISOString(),
    outcome: null,
  };
  await safeUpdateTask(task.id, { status: 'negotiating', payload: { ...task.payload, negotiation } });
  await safeAddStep(task.id, { step: `Negotiation started (mode: ${negotiation.mode})`, status: 'completed' });

  const timeoutAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const { create: createTask } = require('../../../../packages/db/queries/tasks');
  try {
    await createTask({
      business_id: task.business_id,
      type: 'negotiation_timeout',
      title: `Negotiation timeout check: ${task.supplier_name || 'supplier'}`,
      status: 'scheduled',
      urgency: 'low',
      supplier_id: task.supplier_id,
      supplier_name: task.supplier_name,
      payload: { parent_task_id: task.id },
      scheduled_at: timeoutAt,
      requires_approval: false,
    });
  } catch (e) {
    console.error('negotiation: failed to schedule 48h timeout:', e.message);
  }
}

async function draftCounter(task, business, supplier) {
  const neg = task.payload.negotiation;
  const latestQuote = task.payload.latest_quote || {};
  const limits = business.notification_prefs?.negotiation_limits || {};
  const prompt = `You are negotiating a purchase on behalf of "${business.name}" with supplier "${supplier?.name || task.supplier_name}".

Their latest offer: ${latestQuote.unit_price} ${neg.currency} per unit for ${neg.quantity} units.
Your target price: ${neg.target_price} ${neg.currency} per unit.
Your absolute ceiling (never reveal this): ${neg.walk_away_price} ${neg.currency} per unit.
This is round ${neg.round + 1} of ${neg.max_rounds}.
Owner's limits: ${Object.keys(limits).length ? JSON.stringify(limits) : 'use your best judgment for a fair deal'}.

Write a short, polite counter-offer message (2-4 sentences) proposing a price closer to the target. Do not reveal the target or ceiling numbers directly. Return plain text only, no JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model: resolveModel('llama-3.1-8b-instant'),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.6,
    });
    return response.choices[0].message.content.trim();
  } catch (e) {
    console.error('negotiation: draftCounter LLM failed, using template fallback:', e.message);
    return `Thank you for the quote. We'd like to propose ${neg.target_price} ${neg.currency} per unit for ${neg.quantity} units, given our order volume. Could you work with this price?`;
  }
}

async function sendCounter(bot, task, business, supplier, draftText) {
  const neg = task.payload.negotiation;
  if (supplier?.contact_telegram) {
    await bot.sendMessage(supplier.contact_telegram, draftText);
  }
  neg.history.push({ round: neg.round, from: 'us', unit_price: null, message: draftText, at: new Date().toISOString() });
  neg.round += 1;
  neg.pending_draft = null;
  neg.last_activity_at = new Date().toISOString();
  await safeUpdateTask(task.id, { payload: { ...task.payload, negotiation: neg } });
  await safeAddDecisionLog(task.id, { action: 'counter_sent', round: neg.round, message: draftText, timestamp: neg.last_activity_at });
  await notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'counter_sent', { text: draftText });
}

async function acceptDeal(bot, task, business, supplier) {
  const neg = task.payload.negotiation;
  const quote = task.payload.latest_quote || {};
  neg.outcome = 'accepted';
  await safeUpdateTask(task.id, {
    status: 'approved',
    approved_by: neg.mode === 'draft' ? 'owner' : 'agent',
    approved_at: new Date().toISOString(),
    estimated_amount: quote.unit_price && neg.quantity ? quote.unit_price * neg.quantity : task.estimated_amount,
    payload: { ...task.payload, negotiation: neg },
  });
  await safeAddDecisionLog(task.id, { action: 'deal_accepted', round: neg.round, unit_price: quote.unit_price, timestamp: new Date().toISOString() });
  if (supplier?.contact_telegram) {
    await bot.sendMessage(supplier.contact_telegram, `Deal confirmed at ${quote.unit_price || '?'} ${neg.currency} per unit for ${neg.quantity} units. Thank you!`);
  }
  await notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'accepted', {
    text: `${quote.unit_price || '?'} ${neg.currency} × ${neg.quantity} = ${(quote.unit_price || 0) * neg.quantity} ${neg.currency}`,
  });
}

async function walkAway(bot, task, business, supplier, reason) {
  const neg = task.payload.negotiation;
  neg.outcome = 'walked_away';
  await safeUpdateTask(task.id, { status: 'cancelled', payload: { ...task.payload, negotiation: neg } });
  await safeAddDecisionLog(task.id, { action: 'walked_away', round: neg.round, reason: reason || 'price above walk-away threshold', timestamp: new Date().toISOString() });
  if (supplier?.contact_telegram) {
    await bot.sendMessage(supplier.contact_telegram, `Thank you for your time, but we won't be able to proceed at this price. We'll reach out if things change.`);
  }
  await notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'walked_away', {
    text: reason || `${task.supplier_name || 'Supplier'}'s price stayed above your walk-away threshold after ${neg.round} round(s).`,
  });
}

async function handleSupplierQuote(bot, task, business, supplier, quote) {
  const neg = task.payload.negotiation;
  neg.history.push({ round: neg.round, from: 'supplier', unit_price: quote.unit_price, message: null, at: new Date().toISOString() });
  neg.last_activity_at = new Date().toISOString();
  task.payload = { ...task.payload, negotiation: neg, latest_quote: quote };
  await safeUpdateTask(task.id, { payload: task.payload });

  const outcome = evaluateQuote(neg, quote);
  const mode = business.trust_level >= 3 ? neg.mode : (business.trust_level >= 2 ? (neg.mode === 'full' ? 'auto' : neg.mode) : 'draft');

  if (outcome === 'accept') {
    return acceptDeal(bot, task, business, supplier);
  }
  if (outcome === 'walk_away') {
    return walkAway(bot, task, business, supplier);
  }
  if (outcome === 'escalate') {
    neg.outcome = 'escalated';
    await safeUpdateTask(task.id, { payload: { ...task.payload, negotiation: neg } });
    return notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'escalated', {
      text: `${quote.unit_price} ${neg.currency} after ${neg.round} rounds — still above your target of ${neg.target_price}. Decide manually.`,
      buttons: [[
        { text: '✅ Accept anyway', callback_data: `neg_accept_${task.id}` },
        { text: '🚫 Walk away', callback_data: `neg_walk_${task.id}` },
      ]],
    });
  }

  // outcome === 'counter'
  if (mode === 'draft') {
    const draft = await draftCounter(task, business, supplier);
    neg.pending_draft = { text: draft, drafted_at: new Date().toISOString() };
    await safeUpdateTask(task.id, { payload: { ...task.payload, negotiation: neg } });
    return notifyOwner(bot, business, { ...task, payload: { ...task.payload, negotiation: neg } }, 'draft_ready', {
      text: draft,
      buttons: [[
        { text: '📤 Send', callback_data: `neg_send_${task.id}` },
        { text: '🚫 Walk away instead', callback_data: `neg_walk_${task.id}` },
      ]],
    });
  }
  if (mode === 'auto') {
    const draft = await draftCounter(task, business, supplier);
    await sendCounter(bot, task, business, supplier, draft);
    return;
  }
  // mode === 'full' — silent round, no per-round owner ping
  const draft = await draftCounter(task, business, supplier);
  return sendCounter(bot, task, business, supplier, draft);
}

module.exports = {
  evaluateQuote,
  startNegotiation,
  draftCounter,
  sendCounter,
  acceptDeal,
  walkAway,
  handleSupplierQuote,
  notifyOwner,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/negotiation-evaluate.test.mjs`
Expected: PASS — all 8 tests (6 from Task 3 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/negotiation.js tests/negotiation-evaluate.test.mjs
git commit -m "feat(negotiation): full state machine (startNegotiation, draftCounter, sendCounter, acceptDeal, walkAway, handleSupplierQuote, notifyOwner)"
```

---

## Task 5: Wire `agent.js` supply_reorder branch into the negotiation loop

**Files:**
- Modify: `apps/bot/src/services/agent.js:32-34` (dedupe check), `apps/bot/src/services/agent.js:332` (completion), imports at top

**Interfaces:**
- Consumes: `negotiation.startNegotiation(bot, task, business, supplier)` from Task 4.
- Produces: no new exports — `agent.js` keeps exporting `{ runAgentChecks, executeTask, checkCustomerFollowups }` unchanged.

- [ ] **Step 1: Fix the dedupe check to include in-flight negotiations**

In `checkInventory` (`apps/bot/src/services/agent.js:32-34`), change:

```js
        const existing = await require('../../../../packages/db/queries/tasks').findByBusiness(business.id, { status: 'pending' });
        const alreadyPending = existing.some(t => t.type === 'supply_reorder' && t.product_id === product.id);
        if (alreadyPending) continue;
```

to:

```js
        const { findByBusiness: findAllTasksForDedupe } = require('../../../../packages/db/queries/tasks');
        const inFlightStatuses = ['pending', 'awaiting_approval', 'negotiating'];
        const existingAll = (await Promise.all(inFlightStatuses.map(s => findAllTasksForDedupe(business.id, { status: s })))).flat();
        const alreadyPending = existingAll.some(t => t.type === 'supply_reorder' && t.product_id === product.id);
        if (alreadyPending) continue;
```

- [ ] **Step 2: Replace the hard completion with `startNegotiation`, only for the Telegram channel**

In the `supply_reorder` branch (`apps/bot/src/services/agent.js:190-334`), add the import at the top of the file (after line 7):

```js
const negotiation = require('./negotiation');
```

Then change the tail of the branch. Current code (line 270-334):

```javascript
      if (channel === 'telegram' && supplier?.contact_telegram) {
        await bot.sendMessage(supplier.contact_telegram, body);
        await addStep(taskId, { step: `Sent via Telegram to ${supplier.name}`, status: 'completed' });
        if (ownerChat) await bot.sendMessage(ownerChat, `🤖 Sent reorder to *${supplier.name}* via Telegram:\n\n${body}`, { parse_mode: 'Markdown' });
        dispatched = true;
      }
      else if (channel === 'email' && supplier?.contact_email) {
        ...
      }
      else if (channel === 'whatsapp' && supplier?.whatsapp_number && ownerChat) {
        ...
      }

      // Fallback: no channel resolved → hand the draft to the owner
      if (!dispatched && ownerChat) {
        ...
        await addStep(taskId, { step: 'Draft handed to owner (no dispatchable channel)', status: 'completed' });
      }

      await updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
      return;
    }
```

Change to: after the Telegram-channel branch specifically, call `startNegotiation` instead of falling through to the generic completion; every other channel (email/whatsapp/no-channel) keeps the existing `'completed'` behavior verbatim, since a negotiation loop only makes sense where MiniMe can hold a live back-and-forth (Telegram):

```javascript
      let negotiated = false;
      if (channel === 'telegram' && supplier?.contact_telegram) {
        await bot.sendMessage(supplier.contact_telegram, body);
        await addStep(taskId, { step: `Sent via Telegram to ${supplier.name}`, status: 'completed' });
        if (ownerChat) await bot.sendMessage(ownerChat, `🤖 Sent reorder to *${supplier.name}* via Telegram:\n\n${body}`, { parse_mode: 'Markdown' });
        dispatched = true;
        negotiated = true;
      }
      else if (channel === 'email' && supplier?.contact_email) {
        ...   // unchanged
      }
      else if (channel === 'whatsapp' && supplier?.whatsapp_number && ownerChat) {
        ...   // unchanged
      }

      // Fallback: no channel resolved → hand the draft to the owner
      if (!dispatched && ownerChat) {
        ...   // unchanged
        await addStep(taskId, { step: 'Draft handed to owner (no dispatchable channel)', status: 'completed' });
      }

      if (negotiated) {
        const freshTask = await findTask(taskId);
        await negotiation.startNegotiation(bot, freshTask, business, supplier);
      } else {
        await updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
      }
      return;
    }
```

Note: `findTask` is already imported at the top of `agent.js` (line 1, aliased from `findById`) — reuse it to get the task row with fresh `payload`/`estimated_amount` rather than reconstructing it inline.

- [ ] **Step 3: Syntax-check**

Run: `node --check apps/bot/src/services/agent.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/services/agent.js
git commit -m "feat(negotiation): supply_reorder keeps task open in negotiating state via startNegotiation instead of marking completed on Telegram channel"
```

---

## Task 6: Route supplier quote replies into the negotiation dispatcher

**Files:**
- Modify: `apps/bot/src/services/supplierReply.js:115-198`

**Interfaces:**
- Consumes: `negotiation.handleSupplierQuote(bot, task, business, supplier, quote)` from Task 4.

- [ ] **Step 1: Add the routing branch**

In `apps/bot/src/services/supplierReply.js`, add near the top:

```js
const negotiation = require('./negotiation');
```

Then, in the block that currently sets `status: quote.confidence >= 0.5 ... ? 'awaiting_approval' : task.status` (lines 126-138), branch on whether the task is already `'negotiating'` — if so, skip the owner-DM-with-buttons path entirely (lines 183-198) and hand off to the dispatcher instead:

```javascript
    // Attach to task (if one exists)
    if (task) {
      await addDecisionLog(task.id, {
        action: 'supplier_reply_received',
        raw_reply: replyText.slice(0, 2000),
        parsed_quote: quote,
        supplier_id: supplier.id,
        timestamp: new Date().toISOString(),
      });
      await addStep(task.id, { step: 'Supplier replied with quote', status: 'completed' });

      if (task.status === 'negotiating') {
        const existingPayload = task.payload || {};
        const freshTask = { ...task, payload: { ...existingPayload, latest_quote: quote, latest_quote_at: new Date().toISOString() } };
        await negotiation.handleSupplierQuote(bot, freshTask, business, supplier, quote);
        return; // negotiation.js owns all Telegram sends for this reply — skip the owner-buttons DM below.
      }

      // Store the parsed quote in the task payload for easy access
      const existingPayload = task.payload || {};
      await updateTask(task.id, {
        payload: {
          ...existingPayload,
          latest_quote: quote,
          latest_quote_at: new Date().toISOString(),
        },
        status: quote.confidence >= 0.5 && (quote.unit_price || quote.available === false)
          ? 'awaiting_approval'  // owner should review the quote
          : task.status,
      });
    }
```

Leave the rest of the function (the owner-buttons DM at lines 183-198, used for the *first* quote when a task isn't negotiating yet) unchanged.

- [ ] **Step 2: Syntax-check**

Run: `node --check apps/bot/src/services/supplierReply.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/services/supplierReply.js
git commit -m "feat(negotiation): route quote replies on negotiating tasks to negotiation.handleSupplierQuote"
```

---

## Task 7: Rework `callback.js` negotiation buttons

**Files:**
- Modify: `apps/bot/src/handlers/callback.js:86-137`

**Interfaces:**
- Consumes: `negotiation.sendCounter`, `negotiation.acceptDeal`, `negotiation.walkAway` from Task 4.

- [ ] **Step 1: Add the import and supplier lookup helper**

Add near the top of `apps/bot/src/handlers/callback.js`:

```js
const negotiation = require('../services/negotiation');
```

- [ ] **Step 2: Make `quote_approve_` negotiation-aware**

Current code (`callback.js:86-100`):

```javascript
    if (data.startsWith('quote_approve_')) {
      const taskId = data.replace('quote_approve_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const quote = task.payload?.latest_quote || {};
      await updateTask(taskId, {
        status: 'approved',
        approved_by: 'owner',
        approved_at: new Date().toISOString(),
        estimated_amount: quote.unit_price && (quote.quantity || 50) ? quote.unit_price * (quote.quantity || 50) : task.estimated_amount,
      });
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await bot.sendMessage(chatId, `✅ Quote approved. Proceed with payment/PO as agreed:\n• ${quote.unit_price || '?'} ${quote.currency || ''} × ${quote.quantity || '?'}\n• Lead time: ${quote.lead_time_days || '?'} days\n• Terms: ${quote.payment_terms || '—'}`);
      await bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
    }
```

Change to branch on `task.status === 'negotiating'` so a supplier confirmation actually gets sent (the old code silently only updated the task, never telling the supplier):

```javascript
    if (data.startsWith('quote_approve_')) {
      const taskId = data.replace('quote_approve_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });

      if (task.status === 'negotiating') {
        const { findByBusiness: findSuppliersForApprove } = require('../../../../packages/db/queries/suppliers');
        const business = await findBusiness(task.business_id);
        const suppliers = await findSuppliersForApprove(task.business_id);
        const supplier = suppliers.find(s => s.name === task.supplier_name);
        await negotiation.acceptDeal(bot, task, business, supplier);
        await bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
        return;
      }

      const quote = task.payload?.latest_quote || {};
      await updateTask(taskId, {
        status: 'approved',
        approved_by: 'owner',
        approved_at: new Date().toISOString(),
        estimated_amount: quote.unit_price && (quote.quantity || 50) ? quote.unit_price * (quote.quantity || 50) : task.estimated_amount,
      });
      await bot.sendMessage(chatId, `✅ Quote approved. Proceed with payment/PO as agreed:\n• ${quote.unit_price || '?'} ${quote.currency || ''} × ${quote.quantity || '?'}\n• Lead time: ${quote.lead_time_days || '?'} days\n• Terms: ${quote.payment_terms || '—'}`);
      await bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
    }
```

- [ ] **Step 3: Rework `quote_negotiate_` to store `pending_draft` with real send/walk buttons**

Current code (`callback.js:110-137`) only drafts a message and DMs it with no follow-up action. Replace it with:

```javascript
    if (data.startsWith('quote_negotiate_')) {
      const taskId = data.replace('quote_negotiate_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const { findByBusiness: findSuppliersForNegotiate } = require('../../../../packages/db/queries/suppliers');
      const business = await findBusiness(task.business_id);
      const suppliers = await findSuppliersForNegotiate(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);

      // First negotiate tap on a task that isn't in a negotiation yet — start one now.
      if (task.status !== 'negotiating') {
        await negotiation.startNegotiation(bot, task, business, supplier);
      }
      const freshTask = await findTask(taskId);
      const draft = await negotiation.draftCounter(freshTask, business, supplier);
      const neg = freshTask.payload.negotiation;
      neg.pending_draft = { text: draft, drafted_at: new Date().toISOString() };
      await updateTask(taskId, { payload: { ...freshTask.payload, negotiation: neg } });

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await bot.sendMessage(chatId,
        `💬 *Negotiation draft for ${task.supplier_name}*:\n\n${draft}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[
            { text: '📤 Send', callback_data: `neg_send_${taskId}` },
            { text: '🚫 Walk away instead', callback_data: `neg_walk_${taskId}` },
          ]] },
        }
      );
      await bot.answerCallbackQuery(query.id, { text: '💬 Draft ready' });
    }

    if (data.startsWith('neg_send_')) {
      const taskId = data.replace('neg_send_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const business = await findBusiness(task.business_id);
      const { findByBusiness: findSuppliersForSend } = require('../../../../packages/db/queries/suppliers');
      const suppliers = await findSuppliersForSend(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);
      const draftText = task.payload?.negotiation?.pending_draft?.text;
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      if (!draftText) return bot.answerCallbackQuery(query.id, { text: '❌ No draft found' });
      await negotiation.sendCounter(bot, task, business, supplier, draftText);
      await bot.answerCallbackQuery(query.id, { text: '📤 Sent' });
    }

    if (data.startsWith('neg_walk_')) {
      const taskId = data.replace('neg_walk_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const business = await findBusiness(task.business_id);
      const { findByBusiness: findSuppliersForWalk } = require('../../../../packages/db/queries/suppliers');
      const suppliers = await findSuppliersForWalk(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await negotiation.walkAway(bot, task, business, supplier, 'Owner chose to walk away');
      await bot.answerCallbackQuery(query.id, { text: '🚫 Walked away' });
    }

    if (data.startsWith('neg_accept_')) {
      const taskId = data.replace('neg_accept_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const business = await findBusiness(task.business_id);
      const { findByBusiness: findSuppliersForAccept } = require('../../../../packages/db/queries/suppliers');
      const suppliers = await findSuppliersForAccept(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await negotiation.acceptDeal(bot, task, business, supplier);
      await bot.answerCallbackQuery(query.id, { text: '✅ Accepted' });
    }
```

- [ ] **Step 4: Syntax-check**

Run: `node --check apps/bot/src/handlers/callback.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/handlers/callback.js
git commit -m "feat(negotiation): wire quote_negotiate_/quote_approve_ into the negotiation engine, add neg_send_/neg_walk_/neg_accept_ handlers"
```

---

## Task 8: `/negotiation` command (mode + limits)

**Files:**
- Modify: `apps/bot/src/handlers/command.js` (new `case '/negotiation':` before `case '/help':` at line 551; one new line inside the `/help` string block)

**Interfaces:**
- Consumes: nothing new — reads/writes `business.negotiation_mode` and `business.notification_prefs.negotiation_limits` directly via the same `supabase`/`updateBusiness` helper other command cases already use in this file (verify the exact helper name in context around the existing `/trust` case before writing — it is imported at the top of `command.js` alongside the other query helpers).
- Produces: a new `negmode_*` callback pattern (`negmode_draft`, `negmode_auto`, `negmode_full`) consumed by a new handler in `callback.js` (added in this task, not Task 7, since it's purely a settings toggle unrelated to an active negotiation).

- [ ] **Step 1: Add the command case**

Insert before `case '/help':` (`command.js:551`):

```javascript
      case '/negotiation': {
        const parts = msg.text.trim().split(/\s+/);
        const sub = parts[1];

        if (sub === 'limits') {
          const targetPct = parseFloat(parts[2]);
          const rounds = parseInt(parts[3], 10);
          const walkAwayPct = parseFloat(parts[4]);
          if (!Number.isFinite(targetPct) || !Number.isFinite(rounds) || !Number.isFinite(walkAwayPct)) {
            await bot.sendMessage(chatId, 'Usage: /negotiation limits <target%> <rounds> <walkaway%>\nExample: /negotiation limits 10 3 25');
            break;
          }
          await updateBusiness(business.id, {
            notification_prefs: {
              ...business.notification_prefs,
              negotiation_limits: { discount_target_pct: targetPct, max_rounds: rounds, walk_away_pct: walkAwayPct },
            },
          });
          await bot.sendMessage(chatId, `✅ Negotiation limits updated: target ${targetPct}% off, max ${rounds} rounds, walk away above ${walkAwayPct}% over ask price.`);
          break;
        }

        const modes = [
          { key: 'draft', label: '📝 Draft — I approve every message', minTrust: 0 },
          { key: 'auto', label: '⚙️ Auto — within limits, final deal needs approval', minTrust: 2 },
          { key: 'full', label: '🤖 Full — silent rounds, final report only', minTrust: 3 },
        ];
        const current = business.negotiation_mode || 'draft';
        const keyboard = modes
          .filter(m => business.trust_level >= m.minTrust)
          .map(m => [{ text: `${m.label}${m.key === current ? ' ✓' : ''}`, callback_data: `negmode_${m.key}` }]);
        const limits = business.notification_prefs?.negotiation_limits;
        const limitsText = limits
          ? `Target: ${limits.discount_target_pct}% off · Max rounds: ${limits.max_rounds} · Walk away above: ${limits.walk_away_pct}% over ask`
          : 'Not set — using defaults (10% off, 3 rounds, walk away at 25% over ask)';
        await bot.sendMessage(chatId,
          `Current negotiation mode: *${current}*\n\n${limitsText}\n\nSet limits: /negotiation limits <target%> <rounds> <walkaway%>\n\nSelect mode:`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
        );
        break;
      }
```

- [ ] **Step 2: Add the `negmode_*` callback handler**

In `apps/bot/src/handlers/callback.js`, add a new branch (near the `trust_set_` handler, following its exact pattern):

```javascript
    if (data.startsWith('negmode_')) {
      const mode = data.replace('negmode_', '');
      const business = await findBusiness(businessId); // businessId already resolved earlier in this handler for the calling chat
      const minTrust = { draft: 0, auto: 2, full: 3 }[mode];
      if (business.trust_level < minTrust) {
        await bot.answerCallbackQuery(query.id, { text: `❌ Requires trust level ${minTrust}+` });
        return;
      }
      await updateBusiness(business.id, { negotiation_mode: mode });
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await bot.sendMessage(chatId, `✅ Negotiation mode set to *${mode}*.`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(query.id, { text: '✅ Updated' });
    }
```

Note: confirm the exact variable name used for "the business tied to this chat" at the top of `handleCallbackQuery` (it's resolved once per callback for the other handlers, e.g. how `trust_set_` gets its `business`) and reuse that binding rather than re-deriving `businessId` — the pseudocode above uses a placeholder name (`businessId`) that must be replaced with whatever the real local variable is called at that point in the function.

- [ ] **Step 3: Add to `/help`**

In the `/help` string block (`command.js:551-579`), add one line, e.g. after the existing agent-related line:

```javascript
          `🤝 /negotiation — Supplier negotiation mode & limits\n` +
```

- [ ] **Step 4: Syntax-check**

Run: `node --check apps/bot/src/handlers/command.js && node --check apps/bot/src/handlers/callback.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/handlers/command.js apps/bot/src/handlers/callback.js
git commit -m "feat(negotiation): add /negotiation command (mode + limits) and negmode_* callback handler"
```

---

## Task 9: Scheduler wiring for the 48h timeout

**Files:**
- Modify: `apps/bot/src/services/scheduler.js:87` (type filter), `apps/bot/src/services/scheduler.js:142` (dispatch)

**Interfaces:**
- Consumes: `negotiation` service (for the nudge-then-escalate behavior).

- [ ] **Step 1: Add `'negotiation_timeout'` to the fired-types filter**

Current (`scheduler.js:87`):

```javascript
    .in('type', ['reminder', 'followup', 'scheduled_message', 'briefing'])
```

Change to:

```javascript
    .in('type', ['reminder', 'followup', 'scheduled_message', 'briefing', 'negotiation_timeout'])
```

- [ ] **Step 2: Add the dispatch branch in `executeTask`**

Add a new `if` branch in `executeTask` (`scheduler.js:118` onward, alongside the existing `followup`/`supply_reorder` branch at line 142):

```javascript
  if (task.type === 'negotiation_timeout') {
    const { findById: findParentTask } = require('../../../../packages/db/queries/tasks');
    const parentTaskId = task.payload?.parent_task_id;
    const parentTask = parentTaskId ? await findParentTask(parentTaskId) : null;
    if (!parentTask || parentTask.status !== 'negotiating') {
      // Negotiation already resolved (accepted/walked away/completed) — nothing to do.
      return;
    }
    const negotiation = require('./negotiation');
    const { findAll: findAllBusinessesForTimeout } = require('../../../../packages/db/queries/businesses');
    const businesses = await findAllBusinessesForTimeout();
    const business = businesses.find(b => b.id === parentTask.business_id);
    const { findByBusiness: findSuppliersForTimeout } = require('../../../../packages/db/queries/suppliers');
    const suppliers = await findSuppliersForTimeout(parentTask.business_id);
    const supplier = suppliers.find(s => s.name === parentTask.supplier_name);

    const neg = parentTask.payload?.negotiation || {};
    const hoursSinceActivity = neg.last_activity_at ? (Date.now() - new Date(neg.last_activity_at).getTime()) / 3600000 : 999;
    if (hoursSinceActivity < 48) {
      // Activity happened after this timeout was scheduled — reschedule a fresh check.
      const { create: createFollowupCheck } = require('../../../../packages/db/queries/tasks');
      await createFollowupCheck({
        business_id: parentTask.business_id,
        type: 'negotiation_timeout',
        title: `Negotiation timeout check: ${parentTask.supplier_name || 'supplier'}`,
        status: 'scheduled',
        supplier_id: parentTask.supplier_id,
        supplier_name: parentTask.supplier_name,
        payload: { parent_task_id: parentTask.id },
        scheduled_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        requires_approval: false,
      });
      return;
    }

    if (!task.payload?.nudged) {
      if (supplier?.contact_telegram) {
        await bot.sendMessage(supplier.contact_telegram, `Just checking in on our last message — would love to hear back on the offer when you have a chance.`);
      }
      await require('../../../../packages/db/queries/tasks').updateTask(task.id, { payload: { ...task.payload, nudged: true } });
      return;
    }
    // Already nudged once and still silent — escalate to the owner.
    await negotiation.notifyOwner(bot, business, parentTask, 'escalated', {
      text: `${parentTask.supplier_name || 'Supplier'} has been silent for 48h+ after a nudge. Decide manually.`,
      buttons: [[{ text: '🚫 Walk away', callback_data: `neg_walk_${parentTask.id}` }]],
    });
    return;
  }
```

- [ ] **Step 3: Syntax-check**

Run: `node --check apps/bot/src/services/scheduler.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/services/scheduler.js
git commit -m "feat(negotiation): wire 48h negotiation_timeout into fireDueTasks (nudge once, then escalate)"
```

---

## Task 10: Full verification, push, draft PR

**Files:** none new — this task only runs checks and opens the PR.

- [ ] **Step 1: Syntax-check every modified/created file**

```bash
for f in packages/shared/prompts.js apps/bot/src/services/ai.js apps/bot/src/services/notification.js apps/bot/src/services/negotiation.js apps/bot/src/services/agent.js apps/bot/src/services/supplierReply.js apps/bot/src/handlers/callback.js apps/bot/src/handlers/command.js apps/bot/src/services/scheduler.js; do
  node --check "$f" || echo "FAILED: $f"
done
```

Expected: no "FAILED" lines.

- [ ] **Step 2: Run the full negotiation test file**

Run: `node --test tests/negotiation-evaluate.test.mjs`
Expected: PASS, all tests green.

- [ ] **Step 3: Run the full existing test suite to check for regressions**

Run: `node --test tests/`
Expected: all pre-existing tests (`tests/telegram-send.test.mjs`, `tests/fetch-all.test.mjs`) still PASS — this change touches no files they cover, but confirm nothing else broke.

- [ ] **Step 4: Push and open a draft PR**

```bash
git push -u origin claude/minime-future-evolution-2f9e3r
gh pr create --draft --title "feat: Supplier Negotiation Engine" --body "$(cat <<'EOF'
## Summary
- Stateful negotiation loop on agent_tasks.payload.negotiation (draft/auto/full autonomy, gated by trust_level)
- Deterministic evaluateQuote (accept/counter/walk_away/escalate) — LLM only words messages, never decides outcomes
- 48h timeout: one nudge, then owner escalation
- Fixes 3 pre-existing broken imports (makeAgentDecision, notifyOwnerTask, agentDecisionPrompt) that made checkInventory/checkPaymentFollowups throw before this change

## Migration required
`packages/db/migrations/033_negotiation.sql` must be applied via the Supabase SQL editor before this deploys (adds negotiating/executing status, negotiation_timeout type, businesses.negotiation_mode).

## Test plan
- [x] node --test tests/negotiation-evaluate.test.mjs
- [x] node --test tests/ (no regressions)
- [ ] Manual: /negotiation command in a real chat, full round-trip with a test supplier
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** state model (Task 4), businesses.negotiation_mode + notification_prefs.negotiation_limits (Tasks 1, 8), trust gates (Tasks 4, 8), migration 033 + schema mirror (Task 1), negotiation.js full function set (Tasks 3-4), agent.js/supplierReply.js/callback.js/command.js/scheduler.js wiring (Tasks 5-9), pre-existing breaks (Task 2 — plus one the original spec missed: `agentDecisionPrompt`), tests (Tasks 3-4, 10), commit/push/draft PR (Task 10). All spec bullets have a home.
- **Deviation flagged:** the spec's `draftCounter` description says "template fallback" — the actual `aiClient.js` proxy has no such mechanism (only cross-provider failover); Task 4 implements the template fallback inside `draftCounter` itself via try/catch, which satisfies the spec's intent without needing an `aiClient.js` change.
- **Deviation flagged:** `scheduler.js`'s existing `.in('type', [...])` filter (line 87) does not include `supply_reorder`/`customer_followup`/`payment_followup` either — this plan does not touch that (out of scope; those types are driven by `runAgentChecks`, not `scheduled_at` firing), it only adds `negotiation_timeout`, which Task 4 always sets via `scheduled_at` + `status: 'scheduled'`.
