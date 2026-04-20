-- 007_business_contacts.sql
-- Adds public-facing contact + social fields so the AI can share them with customers.
-- Owners fill these in via /settings.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS website       VARCHAR(500),
  ADD COLUMN IF NOT EXISTS whatsapp      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS instagram     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tiktok        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS facebook      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS telegram_channel VARCHAR(255),
  ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS business_hours VARCHAR(255),   -- e.g. "Mon–Sat 9am–7pm"
  ADD COLUMN IF NOT EXISTS address        VARCHAR(500);   -- full address beyond location
