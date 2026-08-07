-- Migration 037: counters for the draft-approval upgrade nudge
--
-- The single best upgrade moment in the product had no prompt in it.
--
-- On Free, MiniMe writes the reply and the owner taps "✅ Send". That tap IS
-- the friction Pro removes, and it happens dozens of times a month — but the
-- only upgrade prompts were on the trial calendar (day 7/3/1) and behind
-- feature gates the owner may never touch. We were asking on OUR schedule
-- instead of at the moment the cost is actually felt.
--
-- These columns let the approve handler count taps and nudge occasionally,
-- with a hard cooldown so it can never become nagging.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS drafts_approved_count  INTEGER NOT NULL DEFAULT 0,
  -- When we last showed the nudge. Enforces the cooldown between prompts, so
  -- an owner who says "not now" isn't asked again tomorrow.
  ADD COLUMN IF NOT EXISTS draft_nudge_last_at    TIMESTAMPTZ;

COMMENT ON COLUMN businesses.drafts_approved_count IS
  'Lifetime count of AI drafts the owner approved by hand. Drives the send-tap upgrade nudge (lib/server/replyEngine.js).';

-- Atomic bump, returning the new total. Read-modify-write from the app would
-- undercount when a busy shop approves several drafts at once.
CREATE OR REPLACE FUNCTION draft_approved_bump(biz_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE businesses
  SET drafts_approved_count = COALESCE(drafts_approved_count, 0) + 1
  WHERE id = biz_id
  RETURNING drafts_approved_count INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;
