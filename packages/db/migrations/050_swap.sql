-- 050_swap.sql
--
-- MiniMe Swap: peer-to-peer barter inside MiniMe Search.
--
-- These are the first tables in the schema keyed to a PERSON rather than a
-- business. A swap lister has no businesses row, no bot token and no shop
-- code — only a Telegram user id. That is deliberate: requiring onboarding
-- would defeat the point of a 30-second post.
--
-- No price column anywhere, by design. A swap post's price is another item
-- (wants_text); adding money here would turn this into classifieds and drag
-- MiniMe into payments it does not process.

begin;

create table if not exists swap_items (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  telegram_username text,
  title text not null,
  wants_text text not null,
  condition text not null check (condition in ('like_new','good','worn','parts')),
  area text not null,
  area_is_freetext boolean not null default false,
  photo_file_ids text[] not null,
  category text,
  keywords text[] not null default '{}',
  want_category text,
  want_keywords text[] not null default '{}',
  lang text not null default 'en',
  status text not null default 'active' check (status in ('active','hidden','swapped','expired')),
  view_count int not null default 0,
  interest_count int not null default 0,
  first_reveal_at timestamptz,
  completion_asked_at timestamptz,
  expiry_asked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists swap_items_keywords_idx      on swap_items using gin (keywords);
create index if not exists swap_items_want_keywords_idx on swap_items using gin (want_keywords);
create index if not exists swap_items_status_expiry_idx on swap_items (status, expires_at);
create index if not exists swap_items_user_idx          on swap_items (telegram_user_id, status);

create table if not exists swap_interests (
  id uuid primary key default gen_random_uuid(),
  swap_item_id uuid not null references swap_items(id) on delete cascade,
  from_telegram_user_id bigint not null,
  from_telegram_username text,
  offer_text text not null,
  asked_completion_at timestamptz,
  confirmed_swapped boolean,
  created_at timestamptz not null default now(),
  unique (swap_item_id, from_telegram_user_id)
);

create index if not exists swap_interests_item_idx on swap_interests (swap_item_id);

create table if not exists swap_reports (
  id uuid primary key default gen_random_uuid(),
  swap_item_id uuid not null references swap_items(id) on delete cascade,
  reported_telegram_user_id bigint not null,
  reporter_telegram_user_id bigint not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (swap_item_id, reporter_telegram_user_id)
);

create index if not exists swap_reports_reported_idx on swap_reports (reported_telegram_user_id);

-- Draft state is in Postgres, not an in-memory Map. The posting wizard is four
-- steps; on Vercel the instance that received step 1 is not guaranteed to
-- receive step 2, and losing a half-finished post is the one failure a first
-- time lister will not retry.
create table if not exists swap_drafts (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  step text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table swap_items     enable row level security;
alter table swap_interests enable row level security;
alter table swap_reports   enable row level security;
alter table swap_drafts    enable row level security;

create policy swap_items_service     on swap_items     for all to service_role using (true) with check (true);
create policy swap_interests_service on swap_interests for all to service_role using (true) with check (true);
create policy swap_reports_service   on swap_reports   for all to service_role using (true) with check (true);
create policy swap_drafts_service    on swap_drafts    for all to service_role using (true) with check (true);

revoke all on swap_items, swap_interests, swap_reports, swap_drafts from anon, authenticated;

commit;
