-- 025_signup_consent.sql
-- Explicit signup consent (terms + AI-disclosure) captured in the mini-app at
-- account creation. Compliance artifact for GDPR / Ethiopia PDP — pairs with the
-- existing trial_disclosed / trial_started audit events.
--
-- Recorded by POST /api/onboarding/signup, set once and never overwritten.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS consent_version TEXT;
