-- Migration 052: let platform_feedback hold a churn reason.
--
-- The exit question has always existed and always worked — reengage/copy.mjs
-- sends the chips, agent-bot/webhook records the tap, the admin dashboard and
-- the weekly digest read it. It has produced 5 reasons in the platform's
-- lifetime because it is only ever put to people who abandoned SIGNUP. Someone
-- who never finished creating a shop can tell you the form was confusing; they
-- cannot tell you why a shop that was working went quiet.
--
-- lib/server/churnExit.mjs asks that second question, of shops with real
-- traffic that have been silent 21-120 days. Its answers land here rather than
-- in reengagement_sends, which is keyed to the signup funnel by telegram_id and
-- answers a different question — keeping them apart is the point, since mixing
-- "too complicated" (never started) with "no customers came" (started, then
-- stopped) makes both datasets unreadable.
--
-- The category CHECK predates that and would have rejected the row. Widening
-- only: every existing value stays valid, and no existing row is touched.
ALTER TABLE platform_feedback
  DROP CONSTRAINT IF EXISTS platform_feedback_category_check;

ALTER TABLE platform_feedback
  ADD CONSTRAINT platform_feedback_category_check
  CHECK (category = ANY (ARRAY['bug'::text, 'feature'::text, 'general'::text,
                               'praise'::text, 'churn_exit'::text]));

COMMENT ON COLUMN platform_feedback.category IS
  'bug | feature | general | praise | churn_exit. For churn_exit rows, note '
  'holds the reason slug from CHURN_EXIT_REASONS in lib/server/churnExit.mjs '
  '(no_customers, i_reply_myself, made_mistakes, too_expensive, shop_closed).';

-- The churn-reason read is "group by note where category='churn_exit'", which
-- is a tiny slice of a small table — but it is the report this whole exercise
-- exists to produce, so give it an index rather than a sequential scan later.
CREATE INDEX IF NOT EXISTS idx_platform_feedback_churn_exit
  ON platform_feedback(created_at DESC) WHERE category = 'churn_exit';
