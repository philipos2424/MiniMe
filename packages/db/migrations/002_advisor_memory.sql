-- Add advisor memory: stores last N advisor Q&A turns per business.
-- Each entry: { q, a, ts }
alter table businesses
  add column if not exists advisor_memory jsonb default '[]'::jsonb;
