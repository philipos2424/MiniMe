-- ═══════════════════════════════════════════════════════════════════════════
-- Trial/consent columns that the code already writes (currently silently
-- stripped on PGRST204 — trial start dates and consent audit are being LOST),
-- plus the referral program (give 30%, get 30%).
-- Run once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- Written by /api/onboarding/complete-shared and /api/bot/link on activation.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
-- Written by /api/onboarding/signup at the consent moment (GDPR / Ethiopia PDP).
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS consent_at      timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS consent_version text;

-- ── Referral program ─────────────────────────────────────────────────────────
-- referral_code: minted lazily the first time an owner asks for their link.
-- referred_by:   set at signup when a new business arrives via ref_CODE.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS referred_by   uuid REFERENCES businesses(id);

CREATE INDEX IF NOT EXISTS businesses_referral_code_idx
  ON businesses (referral_code) WHERE referral_code IS NOT NULL;

-- One row per side per successful referral. UNIQUE(referred_business_id, side)
-- makes awards idempotent — re-activation can never double-credit.
CREATE TABLE IF NOT EXISTS referral_rewards (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  referred_business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  side                 text NOT NULL CHECK (side IN ('referrer', 'referred')),
  reward_percent       integer NOT NULL DEFAULT 30,
  status               text NOT NULL DEFAULT 'earned'
                       CHECK (status IN ('earned', 'applied', 'expired')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_business_id, side)
);

CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx
  ON referral_rewards (referrer_business_id, status);

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
