# People Manager v2 — Per-person secretary control

**Date:** 2026-06-15
**Status:** Approved for planning
**Scope:** First of three planned specs. This one covers manual add + full editing + per-person behavior rules. Per-person *memory* (likes/preferences/facts) and the *relationship graph + proactive suggestions* are deliberately deferred to their own later specs.

## Problem

In secretary mode the bot replies **as the owner** on their personal Telegram. Today:

- When an **unknown** person messages, the bot intentionally does **not** reply — in the default `ask_first` mode it sends the owner a "who is this?" classify prompt and waits. This reads as "the new person isn't getting a response."
- People can only be added by tapping the Telegram classify buttons. The advertised "forward a message + `/personal`" manual-add flow is **documented but not implemented** — `/personal` only lists and removes.
- The [People page](../../../apps/web/src/app/(dashboard)/settings/people/page.js) only edits family/friend contacts and offers a single free-text `context` box. There is no way to control *how* the bot behaves toward a specific person.

The owner wants to: add/edit people manually, and give per-person "orders" for how the bot should behave with each individual.

## Non-goals (this spec)

- Per-person memory of likes/preferences/facts the bot learns over time → **separate spec**.
- Relationship graph (who-knows-who), correlation, and proactive suggestions → **separate spec**.
- Migrating `personal_contacts` to a dedicated DB table → deferred until the memory/graph specs need it.

## Approach

**Extend the existing `notification_prefs.personal_contacts` JSON array** (Approach A). This array already threads through the entire reply engine, so behavior hooks are mostly "read one more field." No migration, no new table. The dedicated-table approach (B) is the planned migration path when the memory + graph features land.

## Data model

Each entry in `notification_prefs.personal_contacts` (JSONB on `businesses`) gains fields. All new fields are optional and backward-compatible — old entries render with defaults, no migration.

```
{
  telegram_id, name, aliases[], context,            // existing
  relation:     family | friend | colleague | customer | vip | other,   // expanded
  reply_mode:   default | auto | ask_first | silent,  // per-person; default = inherit global secretary_mode
  instructions: ''                                  // NEW — "how to behave" (the orders)
  tone:         default | warm | formal | playful | brief,   // NEW
  added_at, source: forward | classify | manual
}
```

- `context` = **facts** about them ("my brother, getting married in Meskerem").
- `instructions` = **how to act** ("always formal, never discuss money"). Authoritative — overrides defaults in the prompt.
- `relation` mapping: family/friend/colleague/vip/other → personal treatment (no business pitch); customer → business tone.

## Behavior wiring (reply engine)

In `apps/web/src/lib/server/replyEngine.js`, where a known personal contact is resolved for a `business_message`:

1. **Reply-mode resolution** — `contact.reply_mode` overrides the global `secretary_mode`:
   - `default` → use the business's global `secretary_mode`.
   - `auto` → reply without asking (this is the lever that fixes "new person not responding": set that person to `auto`).
   - `ask_first` → send the owner the classify/confirm prompt, stash the message, do not reply until they act.
   - `silent` → never reply; forward the incoming message to the owner (per-person ghost).
2. **Prompt injection** — extend the existing `contact_profile` block:
   - `instructions` → injected as "Owner's standing orders for this person" (authoritative).
   - `tone` → one-line style directive.
   - `relation` → personal-vs-business treatment as above.
3. **Live edits** — People-page edits take effect on the next message (read fresh per message, as today).

The webhook-level unknown-contact gate in [agent-bot/webhook/route.js](../../../apps/web/src/app/api/agent-bot/webhook/route.js) is unchanged for *unknown* senders; reply-mode override applies to *known* `personal_contacts` entries.

## Manual add (forward flow — actually implemented)

Fix the flow the People page already advertises, in `replyEngine.js`:

- Owner **forwards a message** from the person, then sends `/personal` (or forwards with no learn-intent caption): if `msg.forward_from.id` is present, create/update a `personal_contacts` entry with `source: 'forward'`, defaulting `relation: 'friend'`, `reply_mode: 'auto'`. Confirm with a button linking to the People page to configure them.
- **Privacy fallback** — if Telegram hid the ID (`forward_sender_name` only, no `forward_from.id`), reply explaining we can't capture them by forwarding, and that they'll be added automatically the next time the person messages directly (existing classify prompt).

## People page (app UI)

In `apps/web/src/app/(dashboard)/settings/people/page.js`:

- Each contact card gains:
  - **relation** dropdown (6 options) — replacing the family/friend-only pills.
  - **reply-mode** pills: Default / Auto / Ask first / Silent.
  - **tone** quick-pick row: Default / Warm / Formal / Playful / Brief.
  - **instructions** textarea (the "orders"), alongside existing name / aliases / context.
- Cards render **all** relations (customer / colleague / vip included), not just family/friend.
- A short "How to add someone" helper (forward + `/personal`), since blank manual-add is impossible without a Telegram ID.
- Save writes the cleaned array back to `notification_prefs.personal_contacts` (existing save path).

## Error handling

- All new fields optional → no migration; legacy entries default safely.
- Writes are last-write-wins on the JSON array (unchanged from today).
- Forward-add with hidden ID degrades gracefully to the privacy-fallback message.

## Testing

- Reply-mode resolution: each of `auto` / `ask_first` / `silent`, plus `default` correctly inheriting the global `secretary_mode`.
- Prompt injection: `instructions` and `tone` appear in the secretary prompt; `instructions` overrides defaults.
- Relation mapping: customer → business tone; family/friend/colleague/vip/other → personal, no pitch.
- Forward-add: ID present → entry created; ID hidden → privacy-fallback message, no entry.
- People page: load/edit/save round-trips all new fields; legacy entries (no new fields) render with defaults.
