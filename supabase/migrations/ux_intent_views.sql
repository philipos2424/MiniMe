-- Deriving INTENTION from the raw click stream.
-- Run in Supabase SQL Editor AFTER ux_events.sql and ux_feature_map.sql.
--
-- Intent is computed at READ time, never guessed at write time. The raw stream
-- stays a faithful record of what happened; these views are opinions about it,
-- and an opinion we get wrong can be redefined without re-collecting data.
--
-- All deterministic — no LLM. Session paths (ux_session_paths) are the hook for
-- LLM labelling later if the deterministic signals turn out to be insufficient.

-- ── Frustration ─────────────────────────────────────────────────────────────
-- Rage clicks: 3+ clicks on the same target inside 2 seconds. On a Telegram Mini
-- App this usually means a control looked tappable and did nothing, or a slow
-- handler gave no feedback.
-- ELAPSED TIME USES occurred_at, NOT created_at. Events are batched by the client
-- (flushed on 10 events / 5s idle / page hide), so created_at is the FLUSH time:
-- identical for every event in a batch, then jumping several seconds at each
-- boundary. Deltas taken from it measure our own batching, not the user. seq
-- still does the ordering — occurred_at is a cheap-handset wall clock and is
-- clamped, not trusted, by /api/track.
CREATE OR REPLACE VIEW ux_rage_clicks AS
WITH runs AS (
  SELECT
    session_id, target, route, intent, created_at, occurred_at, business_id,
    LAG(occurred_at, 2) OVER w AS third_last_at,
    LAG(target, 1) OVER w      AS prev_target,
    LAG(target, 2) OVER w      AS prev2_target
  FROM ux_events
  WHERE event = 'click' AND target IS NOT NULL
  WINDOW w AS (PARTITION BY session_id ORDER BY seq)
)
SELECT session_id, business_id, route, target, intent, created_at
FROM runs
WHERE target = prev_target
  AND target = prev2_target
  AND third_last_at IS NOT NULL
  AND occurred_at - third_last_at BETWEEN INTERVAL '0 seconds' AND INTERVAL '2 seconds';

-- Dead clicks: a click with no nav/submit/view within 3 seconds — the affordance
-- promised something and nothing happened.
CREATE OR REPLACE VIEW ux_dead_clicks AS
WITH nexts AS (
  SELECT
    id, session_id, business_id, route, target, intent, created_at, occurred_at, event,
    LEAD(event) OVER w       AS next_event,
    LEAD(occurred_at) OVER w AS next_at
  FROM ux_events
  WINDOW w AS (PARTITION BY session_id ORDER BY seq)
)
SELECT id, session_id, business_id, route, target, intent, created_at
FROM nexts
WHERE event = 'click'
  AND (
    next_event IS NULL
    OR next_event NOT IN ('nav', 'submit', 'view')
    -- occurred_at, not created_at: see the note on ux_rage_clicks. With
    -- created_at this fired on the last click of every batch.
    OR next_at - occurred_at > INTERVAL '3 seconds'
  );

-- ── Session paths ───────────────────────────────────────────────────────────
-- The ordered sequence of a visit. Ordered by seq, not by timestamp: Mini App
-- devices routinely have skewed clocks, so ordering by occurred_at would
-- scramble paths on exactly the cheap handsets most of our owners use.
CREATE OR REPLACE VIEW ux_session_paths AS
SELECT
  session_id,
  MIN(created_at)                                          AS started_at,
  MAX(created_at)                                          AS ended_at,
  MAX(created_at) - MIN(created_at)                        AS duration,
  MIN(surface)                                             AS surface,
  MAX(business_id::text)::uuid                             AS business_id,
  MAX(tg_user_id)                                          AS tg_user_id,
  COUNT(*)                                                 AS events,
  ARRAY_AGG(route  ORDER BY seq) FILTER (WHERE event = 'nav')     AS route_path,
  ARRAY_AGG(intent ORDER BY seq) FILTER (WHERE intent IS NOT NULL) AS intent_path
FROM ux_events
GROUP BY session_id;

-- ── Agent funnel ────────────────────────────────────────────────────────────
-- Does the owner TRUST what MiniMe writes? llm_call_log already tells us a model
-- ran; nothing until now told us whether the owner accepted, edited, or threw
-- away the result. The accept-vs-edit-vs-reject ratio is the single best proxy
-- for agent quality we can collect.
-- Built on ux_events_resolved (not ux_events) because screen OPENS carry no
-- intent — they're plain `nav` rows — so the funnel's top of funnel has to come
-- from the feature map's area, while the rest comes from declared intents.
CREATE OR REPLACE VIEW ux_agent_funnel AS
SELECT
  day,
  business_id,
  COUNT(*) FILTER (WHERE event = 'nav' AND area = 'agent')               AS agent_opens,
  COUNT(*) FILTER (WHERE intent = 'agent.ask.send')                      AS asked,
  COUNT(*) FILTER (WHERE intent = 'agent.reply.shown')                   AS replies_shown,
  COUNT(*) FILTER (WHERE intent = 'agent.reply.accept')                  AS accepted,
  COUNT(*) FILTER (WHERE intent = 'agent.reply.edit')                    AS edited,
  COUNT(*) FILTER (WHERE intent = 'agent.reply.reject')                  AS rejected,
  COUNT(*) FILTER (WHERE intent IN ('agent.teach.save', 'agent.knowledge.upload')) AS taught
FROM (SELECT *, date_trunc('day', created_at) AS day FROM ux_events_resolved) r
-- agent.* intents also fire from non-agent screens (DraftApproval lives on
-- /conversations/[id]), so both halves of the OR are load-bearing.
WHERE area = 'agent' OR intent LIKE 'agent.%'
GROUP BY day, business_id;

-- ── Search funnel ───────────────────────────────────────────────────────────
-- search_logs stops at the query string: we know what was typed and how many
-- results came back, but never what the searcher DID next. This closes that gap.
CREATE OR REPLACE VIEW ux_search_funnel AS
SELECT
  date_trunc('day', created_at) AS day,
  surface,
  COUNT(*) FILTER (WHERE intent = 'search.query.submit')  AS searches,
  COUNT(*) FILTER (WHERE intent = 'search.result.click')  AS result_clicks,
  COUNT(*) FILTER (WHERE intent = 'search.zero_result')   AS zero_results,
  COUNT(*) FILTER (WHERE intent = 'search.refine')        AS refinements,
  COUNT(*) FILTER (WHERE intent = 'search.voice.start')   AS voice_searches,
  COUNT(DISTINCT session_id)                              AS sessions,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE intent = 'search.result.click')
    / NULLIF(COUNT(*) FILTER (WHERE intent = 'search.query.submit'), 0)
  , 1)                                                    AS click_through_pct
FROM ux_events
WHERE intent LIKE 'search.%'
GROUP BY day, surface;
