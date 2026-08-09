-- 039_team_invite_link.sql — Frictionless team-member invites
--
-- Adding a teammate today means typing their exact @telegram_username, and
-- Telegram's Bot API can't message someone who has never opened a chat with
-- the bot — the owner only finds out later via a manual "Test DM". This adds
-- a one-tap deep-link invite (t.me/<bot>?start=team_<token>), mirroring the
-- existing customer `/start shop_<code>` pattern: the token identifies the
-- pending supplier row, and the moment the teammate taps the link Telegram
-- hands us their real chat id — no typing, no guessing.
--
-- No new status enum: a member is "pending" while contact_telegram IS NULL
-- and "active" once it's set (claiming the invite just fills that column).
--
-- `invite_token` and `invite_created_at` already exist on this table (a
-- prior, never-finished pass at this same idea — idx_suppliers_invite_token
-- is already a unique partial index on invite_token). Reusing both column
-- names rather than adding parallel invited_at/invite_token duplicates; the
-- only genuinely missing piece is joined_at.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS invite_token VARCHAR(32);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_invite_token ON suppliers(invite_token) WHERE invite_token IS NOT NULL;
