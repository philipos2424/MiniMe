# MiniMe Swap — peer-to-peer barter inside MiniMe Search

Date: 2026-09-02
Status: Approved design, ready for implementation planning

## 1. Purpose

MiniMe Search today indexes one kind of supply: onboarded *businesses* and their
catalog products. Swap adds a second, parallel supply — **items owned by
individuals** — discoverable through the same search box.

The transaction is **barter only**. There is no price field and no money. A swap
post's price is another item. This is deliberate: it keeps MiniMe out of
payments and consumer classifieds, and it is the one framing that does not
compete with the paying business side.

### Success criteria

- A person can post an item in under 30 seconds without learning a command.
- A searcher for "phone" sees relevant swap items in the same result set,
  under the businesses.
- The `Wants:` line is the first thing read on every swap card.
- Swap results never outrank, replace, or dilute business results.

### Non-goals (v1)

- Money, prices, escrow, delivery, shipping.
- Auto-matching / notification when a two-way fit appears (deferred; the reverse
  index in §5 makes it cheap to add later).
- Business trade-ins.
- A public reputation score. See §9 for what is possible instead.
- A Swap tab in the Market mini-app. Chat-first only.

## 2. Actors

| Actor | Identity today | Note |
|---|---|---|
| Lister | Telegram user, no business record | New actor. Not a `businesses` row. |
| Interested party | Telegram user | Same person type as the lister |
| Admin | existing `/admin` | Reviews reported posts |

An individual has no `business_id`, no bot token, no shop code. Swap records key
off `telegram_user_id` directly.

## 3. The swap post

One post is: **photos (1–3) · description · wants · condition · area**.

| Field | Source | Required |
|---|---|---|
| `photo_file_ids` | Telegram `file_id`s, 1–3 | yes (at least 1) |
| `title` | typed description, max 120 chars | yes |
| `wants_text` | typed, max 120 chars | yes |
| `condition` | one of `like_new`, `good`, `worn`, `parts` | yes (one tap) |
| `area` | picked from list, or free text via "Somewhere else" | yes |
| `category`, `keywords` | parsed from `title` | derived |
| `want_category`, `want_keywords` | parsed from `wants_text` | derived |
| `lang` | detected from the lister's first typed message | derived |

Telegram `file_id`s stay resolvable, so photos are **not** copied into storage
(same reasoning as `downloadTelegramFile` in `paymentScreenshot.js`).

## 4. Posting flow (chat-first)

Photos currently hit `if (!msg?.text && !msg?.voice) return;` at
`searchBot.js:1214` and are dropped — that entry point is free.

A photo now prompts a disambiguation, because in a *search* bot a photo
plausibly means "find me this":

```
[photo]
Bot: What do you want to do with this?
     [Find this]  [Swap it]
```

`Find this` replies that visual search isn't available yet and asks them to
type it. `Swap it` starts the wizard:

```
Bot: What is it? (short — "Redmi Note 10, cracked back")
-->  Bot: What do you want for it?
-->  Bot: Condition?  [Like new] [Good] [Worn] [For parts]
-->  Bot: Where are you? [Bole] [Piassa] [Megenagna] [4 Kilo] [more...] [Somewhere else]
-->  Bot: Live. People searching "phone" in Bole will see it.
          [See how it looks] [Add another] [My swaps]
```

Rules:

- Additional photos sent **before** the description is answered attach to the
  same draft, up to 3. This is the whole multi-photo UI.
- Every prompt is emitted in the language of the lister's own text — Amharic in,
  Amharic out. Keyword extraction runs `translationsOf()` (`termTranslations.mjs`)
  so `ጃኬት` and `jacket` resolve to the same keywords.
- The area list is **data, not hard-coded strings**, with a
  `Somewhere else — type it` fallback storing free text. Typed values tell us
  which cities to promote to buttons; nobody in Hawassa is blocked at step four.

### Draft state

The wizard is multi-step, so its state is **persisted in `swap_drafts`**, not an
in-memory `Map`. The existing `pendingClarifications` Map is single-step and
tolerates loss; a four-step posting flow does not — on Vercel, instance reuse is
not guaranteed between updates. Drafts older than 1 hour are swept.

### Content rules

The same GPT parse that reads the description enforces a banned list — weapons,
medicine/drugs, currency, ID documents, animals. A refusal states the reason
plainly and drops the draft.

## 5. Discovery

Swap items ride inside the normal search result set. Businesses first, then a
divider, then **two** swap blocks — the second is the reverse index, and it is
the change that makes the pool liquid at low volume:

```
Selam Electronics (verified) · Bole
...

-- Swaps from people --
[photo] Redmi Note 10, 128gb, small crack · Good
   Wants: winter jacket or a good watch
   Bole · 2 days ago
   [I'll swap for this]

-- People who WANT a phone --
Selam wants a phone · offering: Nikon D3100 · Piassa
   [I'll swap for this]
```

- Block 1 matches the query against `keywords`/`category` (the *haves*).
- Block 2 matches the query against `want_keywords`/`want_category` (the
  *wants*) — same query, same parse, double the surface area.
- `Wants:` leads every card. In barter that line is the price.

### Placement rules (commercial guardrails)

- **Max 3 swap cards** total per result set.
- Swaps **never** appear above the business block.
- Swaps are **suppressed entirely** on commercially-intentful queries
  (`delivery`, `wholesale`, `shop`, `supplier`, and equivalents).
- Same-area posts sort first, then recency.

### Empty state = recruitment

When a query has no swap items, the line under the business results is:

> Nobody's swapping a phone yet. Have one to trade? Just send me a photo.

Every unmet search advertises the gap to the person best placed to fill it.

## 6. The handshake

Handles are revealed automatically — no owner approval — but a tap costs a
sentence:

```
[I'll swap for this]
Bot: What are you offering? (one line)
User: Nikon D3100, works fine, with charger
Bot: Meron is @meron_x — message her.
     [Open chat with Meron]  [Report]
```

The lister is notified at the same moment, so no DM arrives cold:

> @dawit_t is interested in your Redmi — offering: *Nikon D3100, works fine,
> with charger*. They may message you.

The offer line filters drive-by taps and makes the lister's heads-up
informative. MiniMe then steps out; the swap itself happens in Telegram DMs.

### Guards

- **10 handle reveals per person per day** (`rateLimitPersistent`) — a scraper
  hits the wall, a real swapper never notices.
- A `Report` button on every card and every reveal. **3 distinct reports**
  against one person hides their posts and flags them for admin.
- A lister can hide any post from `My swaps` with one tap, no confirm dialog.
- A user with no Telegram `@username` cannot be revealed — the bot tells them to
  set one before posting.

## 7. Lifecycle

Stale posts are what make used-goods boards feel dead.

- A post **expires after 21 days**, asked first:
  *"Still have the Redmi? [Yes, keep it live] [Gone]"*. Silence goes dark
  quietly. No moderator required.
- **3 days after the first reveal** on an item, *both* sides are asked once,
  never repeated: the lister *"Did you swap the Redmi? [Yes] [Not yet]"* and the
  interested party the mirror question. Two yeses record a confirmed swap (§9);
  the lister's yes alone closes the post.
- `My swaps` lists each post with view and interest counts, so posting feels
  like it did something before anyone bites.

Both jobs run on the existing cron surface (`/api/cron/*`).

## 8. Data model

```sql
swap_items(
  id uuid pk,
  telegram_user_id bigint not null,
  telegram_username text,            -- snapshot; re-checked at reveal
  title text not null,
  wants_text text not null,
  condition text not null,           -- like_new | good | worn | parts
  area text not null,
  area_is_freetext boolean default false,
  photo_file_ids text[] not null,
  category text, keywords text[],
  want_category text, want_keywords text[],
  lang text default 'en',
  status text default 'active',      -- active | hidden | swapped | expired
  view_count int default 0,
  interest_count int default 0,
  first_reveal_at timestamptz,
  completion_asked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
)

swap_interests(
  id uuid pk,
  swap_item_id uuid references swap_items,
  from_telegram_user_id bigint not null,
  offer_text text not null,
  created_at timestamptz default now(),
  unique (swap_item_id, from_telegram_user_id)
)

swap_reports(
  id uuid pk,
  swap_item_id uuid references swap_items,
  reported_telegram_user_id bigint not null,
  reporter_telegram_user_id bigint not null,
  reason text,
  created_at timestamptz default now(),
  unique (swap_item_id, reporter_telegram_user_id)
)

swap_drafts(
  telegram_user_id bigint pk,
  step text not null,                -- await_kind | await_title | await_wants | await_condition | await_area
  payload jsonb not null,
  updated_at timestamptz default now()
)
```

Indexes: `keywords` and `want_keywords` GIN; `(status, expires_at)`;
`(telegram_user_id, status)`.

RLS: service-role only, consistent with migration `047_lock_down_anon_access.sql`.
No anon access — every read goes through the bot.

## 9. Reputation — what is and isn't possible

With handles revealed on interest, MiniMe sees nothing after the handoff. The
only credible signal is **both** sides confirming: the lister's completion ping
plus the same question to the interested party. Two yeses = a confirmed swap.
v1 records this; it does not display a badge. That is the honest ceiling of the
chosen handoff model.

## 10. Code shape

New modules, kept out of the already-1867-line `searchBot.js`:

| File | Responsibility |
|---|---|
| `lib/server/swap/swapPost.js` | Posting wizard: draft state machine, banned-list check |
| `lib/server/swap/swapSearch.js` | Both discovery blocks + placement rules |
| `lib/server/swap/swapInterest.js` | Offer line, reveal, notification, rate limit |
| `lib/server/swap/swapLifecycle.js` | Expiry and completion prompts (cron entry) |
| `lib/server/swap/swapAreas.js` | Area list + normalization |
| `packages/db/migrations/050_swap.sql` | Schema above |
| `api/cron/swap-lifecycle/route.js` | Daily job |

`searchBot.js` changes are deliberately thin:

1. Photo messages route to `swapPost` instead of returning at line 1214.
2. An active draft intercepts the next text message before search runs.
3. After business results are built, `swapSearch` appends its blocks.
4. `handleSearchBotCallback` gains an `sw:` prefix branch, alongside `sb:`.

## 11. Testing

Node test files under `lib/server/__tests__/`, matching the existing
`*.test.mjs` convention:

- `swapSearch.test.mjs` — placement rules: cap of 3, never above businesses,
  suppression on commercial queries, reverse-index matching, area sort.
- `swapPost.test.mjs` — wizard transitions, multi-photo attach, banned-list
  refusal, Amharic keyword extraction via `translationsOf()`.
- `swapInterest.test.mjs` — offer required before reveal, daily reveal cap,
  missing-username refusal, 3-report hide.
- `swapLifecycle.test.mjs` — expiry prompt at 21 days, completion ping once.

## 12. Monetization

Free for everyone in v1. Swap is the acquisition funnel for the paid business
side — the placement rules in §5 exist to keep the funnel from eating the
product.
