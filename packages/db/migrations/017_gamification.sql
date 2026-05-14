-- Migration 017: Gamification — streaks + achievements
-- Achievements are stored as a JSONB array of { id, unlocked_at } objects.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS streak_days             INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active_date        DATE,
  ADD COLUMN IF NOT EXISTS achievements            JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS seeded_achievements_at  TIMESTAMPTZ;

-- Seed timestamp lets us avoid retroactive celebration spam on the first deploy.
UPDATE businesses
SET seeded_achievements_at = NOW()
WHERE seeded_achievements_at IS NULL;
