-- Add search_public_info JSONB to businesses.
-- Controls what @minimesearchbot can share about a business.
-- Default: products and FAQs visible, phone hidden.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS search_public_info JSONB DEFAULT '{
    "products": true,
    "prices": true,
    "faqs": true,
    "address": true,
    "hours": true,
    "phone": false,
    "ai_answers": true
  }'::jsonb;
