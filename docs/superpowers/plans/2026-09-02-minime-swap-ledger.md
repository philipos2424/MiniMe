# SDD ledger — plan: docs/superpowers/plans/2026-09-02-minime-swap.md

Spec: docs/superpowers/specs/2026-09-02-p2p-swap-design.md (read, reachable)
Branch: feat/swap-barter · merge-base 4888161 · plan HEAD e6c9154
Workspace: .superpowers/sdd/2026-09-02-minime-swap/

## Pre-flight scan

Isolation: work proceeds on `feat/swap-barter`, not main. The working tree carries
unrelated uncommitted changes from other branches' work; all swap commits touch only
new files plus `searchBot.js` (Task 8), so no worktree was created.

### Cross-task interface rows (producer → consumer)

| Producer | Consumer | Interface checked | Result |
|---|---|---|---|
| T1 constants | T4 | MAX_PHOTOS, MAX_TEXT, CONDITIONS, CONDITION_LABELS, EXPIRY_DAYS | OK — all exported |
| T1 constants | T5 | MAX_SWAP_CARDS | OK |
| T1 constants | T6 | REPORTS_TO_HIDE | OK |
| T1 constants | T7 | COMPLETION_DELAY_DAYS | OK |
| T1 constants | T8 | DRAFT_TTL_MINUTES, REVEALS_PER_DAY, EXPIRY_DAYS (dynamic import) | OK |
| T1 schema | T7 | `runSwapLifecycle` COLS selects `chat_id` from swap_items | **DEFECT B** — no such column |
| T1 schema | T8 | swap_drafts columns vs saveDraft payload | OK |
| T2 | T4 | areaKeyboard, normalizeArea | OK |
| T2 | T5 | areaLabel | OK |
| T3 | T4 | parseSwapText, expandKeywords, postLang | OK |
| T3 | T8 | postLang | OK |
| T4 | T8 | newDraft, advanceDraft, draftPrompt, publishDraft | OK |
| T5 | T8 | fetchSwapMatches, selectSwapCards, formatSwapBlocks, swapEmptyLine, isCommercialQuery | OK |
| T6 | T8 | recordInterest, recordReport, revealText | **DEFECT D** — select list too narrow |
| T7 | cron route | runSwapLifecycle(sb, {send, now}) | OK |

### Intra-task self-agreement rows

| Task | Tests vs code it specifies | Result |
|---|---|---|
| T1 | no tests (SQL applied by hand) | OK — stated |
| T2 | 5 tests vs swapAreas.mjs | OK |
| T3 | 7 tests vs swapParse.mjs | OK |
| T4 | 10 tests vs swapPost.mjs; cap/truncate/lang paths traced | OK |
| T5 | 11 tests vs swapSearch.mjs; card-cap arithmetic traced (5h/5w → 2+1=3) | **DEFECT L** — reverse-header test regex cannot match the header string |
| T6 | 8 tests vs swapInterest.mjs; fake shapes match call shapes | OK |
| T7 | 7 tests vs swapLifecycle.mjs; fake filter chain matches query chain | OK |
| T8 | 3 tests vs parseSwapCallback; rest is I/O glue | OK — noted, glue covered by manual verification |

### Rulings

Ruling: DEFECT B — `runSwapLifecycle` selects `chat_id`, which `swap_items` does not
have; PostgREST errors on an unknown column, so the cron would fail every run. Decided:
drop `chat_id` from the Task 7 COLS string and send to `telegram_user_id`. The search bot
only ever talks to people in private chats, where chat id equals user id, so the column
would be redundant rather than merely absent. Task 7's test fake keeps `chat_id` on its
rows harmlessly. Cost if wrong: prompts would fail to deliver for any lister who somehow
posted from a group chat — a case the photo entry point does not support anyway.

Ruling: DEFECT D — `handleSwapOfferText` reads `r.item.interest_count` and
`r.item.first_reveal_at`, neither of which `recordInterest` selects, so the counter would
reset to 1 on every interest and `first_reveal_at` would be overwritten on each reveal,
breaking the Task 7 completion ping. Decided: add `interest_count, first_reveal_at` to
`recordInterest`'s select list in Task 6. Cost if wrong: none identified; it widens a
select by two columns.

Ruling: DEFECT L — Task 5's test asserts `/WANT a phone/i` but the header renders
"People who WANT phone", so the test can never pass; and inserting the article would
produce "WANT a shoes" for plural queries. Decided: keep the header article-free and
change the assertion to check for `/who WANT/i` plus `text.includes(query)`. Cost if
wrong: the reverse block's wording reads slightly terse; it is copy, changeable later.

Ruling: DEFECT A (minor, no change) — if `handleSwapOfferText` fails to consume an
`await_offer` draft, `handleSwapDraftText` would pass that step to `advanceDraft`, whose
default branch silently swallows the message. Decided: leave as is — the offer handler is
called first at the only call site, and the draft TTL clears it within the hour. Recorded
so a later reader knows it was seen, not missed. Cost if wrong: one swallowed message in
a path that requires the offer handler to have already errored.

Ruling: deferred minor — `handleSwapPhoto` sends the first prompt in English because no
text has been seen yet, so an Amharic-speaking lister meets one English question before
the wizard switches. Decided: accept for v1; the buttons carry emoji and the next prompt
mirrors their language. Cost if wrong: one slightly worse first impression for Amharic
listers.

## Progress

Task 1: complete (commits e6c9154..cc33dec, review clean — spec ✅, quality approved)
Ruling: commit 0c9eb25 ("checkout: recognize Amharic addresses...", touching replyEngine.js
  and a new checkoutAddressGate test) appeared on feat/swap-barter during Task 2. It is not
  swap work and no swap agent produced it — another session or the user is committing to
  this branch concurrently. Decided: leave it entirely alone, and scope every swap review to
  explicit swap commit SHAs rather than HEAD. Cost if wrong: the final whole-branch review
  range may include a stranger's commit; it is named here so the reviewer can skip it.
Task 2: complete (commits cc33dec..a784b94, review clean — spec ✅, quality approved)
Task 2: minor (deferred): BY_ALIAS stores the Amharic alias un-lowercased while lookup
  lowercases first — harmless (Amharic is caseless), flagged for final triage.
Ruling: Task 3 Important finding vs plan text — the plan mandated an `expandKeywords`
  test using 'jacket', but 'jacket' is absent from termTranslations' glossary, so
  translationsOf returns [] and the bridging loop never runs; the test would pass against
  an implementation that never calls translationsOf. Spec §4 explicitly requires that
  bridging, so the spec wins over the plan's test. Decided: fix the test to use a word in
  the glossary ('phone' → 'ስልክ') and assert the variant appears. Cost if wrong: none; the
  assertion gets strictly stronger.
Ruling: Task 3 Minor folded into the same round — postLang's 'latin-am' branch is
  untested though the brief calls Latin-script Amharic the common case for this audience.
  Decided: add the one-line case now rather than deferring, since the round is already
  open and the branch is a spec-relevant path. Cost if wrong: one extra test.
Task 3: minor (deferred): termTranslations' glossary is business-category vocabulary
  (laptop, catering, salon) and has no used-goods words — 'jacket', 'shoes', 'watch' will
  not bridge scripts for real swap posts. Product gap, not a code defect; for final triage.
Task 3: fix round 1/5 (2 addressed, 0 open; commit 2610344) — re-review confirmed 'phone'
  is in PAIRS and 'selam' genuinely returns 'latin-am'; no new breakage.
Task 3: complete (commits 0c9eb25..2610344, review clean after 1 fix round)
Ruling: Task 4 test-assertion deviation — the brief's `assert.deepEqual(row.keywords,
  ['phone'])` became `.includes('phone')` because the Task 3 fix made expandKeywords add
  'ስልክ' to 'phone', so the exact-array form now fails deterministically. Decided: accept
  the implementer's change. It still fails on an empty/absent keywords array or on
  publishDraft dropping expandKeywords; it merely stops re-asserting swapParse's glossary
  contract inside Task 4's test. Cost if wrong: the publish test no longer pins the exact
  expanded set — swapParse's own tests cover that.
Task 4: complete (commits 2610344..e71c55a, review clean — spec ✅, quality approved)
Task 4: minor (deferred): the MAX_PHOTOS-cap test asserts array length only, not that
  `step` stays 'await_title' after a capped photo. Inherited from the plan; for final triage.
Ruling: Task 5 Important #1 (reverse block lacks a literal "Wants:" label) — the spec
  requires the want to be the first thing read on a card, and the reverse card does lead
  with it ("wants X — offering Y") under a "People who WANT" header; a second literal
  "Wants:" label would be redundant. Decided: keep the format, but the reviewer's real
  point stands — no test pins the wants-card layout, so it can drift silently. Add that
  test. Cost if wrong: the two blocks read slightly differently from each other.
Ruling: Task 5 Important #2 (isCommercialQuery substring matching) — accepted as a real
  defect in the plan's own code: 'shop' matches inside "workshop", 'store' inside
  "restore", so ordinary barter queries would be silently stripped of swap results. Decided:
  fix with word-boundary matching for the Latin terms, keeping substring matching for the
  Ethiopic ones (JS \b is ASCII-only and would never fire on ጅምላ/ሱቅ). Cost if wrong: a
  commercial query slips through and shows up to 3 swap cards below the businesses.
Task 5: fix round 1/5 (2 addressed, 0 open; commit 3d495fe) — Latin terms now word-bounded,
  Ethiopic kept as substrings; wants-card layout pinned; cap still 3. 13/13 passing.
Task 5: complete (commits e71c55a..3d495fe, review clean after 1 fix round)
Ruling: Task 6 DONE_WITH_CONCERNS — the implementer relaxed `item.status !== 'active'` to
  treat a MISSING status as active, because the brief's ITEM fixture omitted the field.
  Wrong direction: migration 050 declares `status text not null default 'active'`, so a
  real row always carries one, and that guard is the entire enforcement of the 3-report
  hide and of expiry. Decided: restore the strict check and fix the FIXTURE to include
  status:'active', matching the schema. Cost if wrong: none — the strict check is what
  production data always satisfies.
Task 6: fix round 1/5 (1 addressed, 0 open; commit 5b83fce) — strict guard restored,
  fixture corrected, hidden-item test added. 9/9 passing.
Task 6: complete (commits 3d495fe..5b83fce, review clean — spec ✅, quality approved)
Task 6: minor (deferred): the swap_reports fake ignores {count:'exact',head:true}; whether
  the real PostgREST response shape matches is unprovable in a unit test. Manual step 8
  of the plan's verification exercises the real client. For final triage.
Ruling: Task 7 Important — the retire loop (status→'expired') has no try/catch, unlike the
  two prompt loops, so one failed update throws out of runSwapLifecycle and out of the cron
  route, abandoning that day's remaining items. Violates the brief's own batch-isolation
  constraint; originates in the plan's code, not the implementer's. Decided: wrap it like
  the other two loops and add a test covering an update failure mid-retire. Cost if wrong:
  none — it strictly widens error tolerance.
Ruling: Task 7 Minor folded into the same round — the test fake's select() ignores its
  column-list argument, so a nonexistent column in COLS would pass every test while failing
  every production run. That is precisely the chat_id bug pre-flight caught by hand.
  Decided: make the fake assert its selected columns against the real column set. Cost if
  wrong: the fake needs updating whenever the schema legitimately gains a column — a cheap
  price for catching a class of bug that unit tests otherwise cannot see.
Task 7: fix round 1/5 (2 addressed, 0 open; commit 1adcf37) — retire loop isolated, fake
  now validates column names (proven by reintroducing chat_id: 7/8 failed). 8/8 passing.
Task 7: complete (commits 5b83fce..1adcf37, review clean after 1 fix round)
Ruling: Task 8 Important — appendSwapBlocks sends the "nobody's swapping X yet" line
  unconditionally whenever formatSwapBlocks returns null, including when fetchSwapMatches
  bailed without querying (no keywords/category) and during the whole pre-migration deploy
  window. Result: every non-commercial search grows a second message. The spec does want
  that recruitment line, but only for a genuine "we looked and found nothing". Decided:
  gate it on having actually run a query. Cost if wrong: slightly fewer recruitment
  impressions on keyword-less queries.
Ruling: Task 8 Minor folded in — the draft interception sits above the pending-review and
  pending-feedback branches, so a stale swap draft would swallow a review comment or a
  feedback note. Those are the file's two other "next message is mine" states and swap now
  outranks both. Decided: move the interception below them. Cost if wrong: a user mid-post
  who also has a pending review answers the review first.
Task 8: minor (deferred): `sw:want` overwrites an in-progress posting draft, discarding a
  half-finished post; searches completed via a clarification tap show no swap cards; a photo
  captioned /start is consumed by the wizard; two swap_drafts selects per text message on
  the hot path. All for final triage.
Task 8: fix round 1/5 (2 addressed, 0 open; commit 05788ac) — recruitment line gated,
  interception moved below the pending states. 637/637, build clean.
Ruling: Task 8 round 1 exposed a conflict in my own fix instruction — the pending-review
  and pending-feedback branches sit BELOW the search rate limiter, so "below the pending
  branches" and "before the rate limiter" cannot both hold. The implementer followed the
  explicit move, so a wizard answer now consumes a search slot: a four-answer post costs 4
  of 10 hourly searches, and the plan's own edit (b) said answering "what is it?" must not
  consume one. Weighing the two: a stale draft swallowing a review comment needs a user to
  be mid-post AND mid-review at once (rare); the slot cost hits every lister, every post.
  Decided: put the interception back above the rate limiter, guarded on neither pending
  state being set for that chat — which satisfies both constraints at once — and hoist the
  draft read so it happens once instead of twice, retiring the deferred hot-path concern
  too. Cost if wrong: a user who is mid-post and mid-review simultaneously answers the post
  first, which is the pre-round-1 behaviour.
Task 8: fix round 2/5 (3 addressed, 0 open; commit a6d141b) — interception above the rate
  limiter and guarded on pendingReviews/pendingFeedback (same chatId key), draft read once.
  637/637, build clean.
Task 8: complete (commits 1adcf37..a6d141b, review clean after 2 fix rounds)
ALL 8 TASKS COMPLETE. Swap commits: cc33dec, a784b94, 4d9dfee, 2610344, e71c55a, dcf63d4,
  3d495fe, fdab761, 5b83fce, 072256d, 1adcf37, 009b311, 05788ac, a6d141b.
  Foreign commit on branch (not ours, leave alone): 0c9eb25.

## Final whole-branch review — FIX FIRST, 3 blockers
C1 Markdown injection: user title/wants/offer interpolated into parse_mode:'Markdown' with
   no escapeMarkdown (which the repo has and uses elsewhere). Phishing links in search
   results, plus one malformed title silently deletes the whole swap block for everyone.
C2 The required photo is never displayed anywhere — no sendPhoto in swap/. Plan defect: my
   formatSwapBlocks returned text only. Spec §5's card and the feature's premise undelivered.
C3 Deploy window: recruitment line appends to EVERY search, and the photo→"Swap it" button
   is dead 100% of the time, because saveDraft fails against the unapplied migration.
I1 sw:keep restores expires_at but not status → "kept live" post stays expired, invisible.
I2 telegram_username never re-checked at reveal, though spec §8 says it is; Telegram recycles
   handles, so a renamed lister sends strangers to an unrelated third party.
I3 rateLimitPersistent falls back to a per-lambda in-memory limiter when the RPC is missing,
   silently removing the only brake on bulk handle harvesting.
I4 sw:keep/gone/done update by id with no ownership check (sw:hide has one).
Ruling: dispatch ONE fix wave covering C1-C3 and I1-I4 — all are small, certain, and the
  first three block merge. Minors (view_count never incremented, two-sided completion
  unbuilt, category ignored when keywords exist, searcherArea hardcoded null, interest_count
  read-modify-write, no rate limit on the photo path) are deferred to the user's judgment.
  All seven previously deferred items were triaged SHIP by the final reviewer.
Final fix wave: commit 7a29dd5 (opus agent cut off by session limit mid-wave; its
  uncommitted swapSearch.mjs work was sound and was completed by a sonnet agent).
  Re-review verdict: SHIP. 650/650 tests, build clean. All 8 findings addressed.
Ruling: residual from I2 — the username write-back after getChat uses .catch(() => {}) on
  the Supabase chain rather than await+try/catch, so on some client versions it could
  silently no-op. Decided: accept. The write-back is best-effort by design and the reveal
  itself uses the freshly fetched handle either way, so a failed write-back costs one extra
  getChat next time, never a wrong handle. Cost if wrong: a stale row lingers in the DB.
