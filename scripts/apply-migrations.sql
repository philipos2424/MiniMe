-- ============================================================
-- MiniMe — apply pending migrations (004 + 005)
-- Paste this ENTIRE file into Supabase SQL Editor and hit Run.
-- Safe to run multiple times (idempotent via IF NOT EXISTS).
-- ============================================================

-- ─── 004: International suppliers ──────────────────────────
alter table suppliers
  add column if not exists contact_email      varchar(255),
  add column if not exists country            varchar(80),
  add column if not exists country_code       varchar(8),
  add column if not exists currency           varchar(8) default 'ETB',
  add column if not exists website_url        text,
  add column if not exists whatsapp_number    varchar(50),
  add column if not exists wechat_id          varchar(120),
  add column if not exists preferred_channel  varchar(20) default 'telegram'
    check (preferred_channel in ('telegram','email','whatsapp','wechat','phone','manual')),
  add column if not exists language           varchar(8)  default 'en',
  add column if not exists min_order_quantity integer,
  add column if not exists lead_time_days     integer,
  add column if not exists payment_terms      text,
  add column if not exists incoterms          varchar(16),
  add column if not exists is_international   boolean default false;

create index if not exists idx_suppliers_business_intl
  on suppliers(business_id, is_international);

update suppliers
   set is_international = true
 where country is not null
   and lower(country) not in ('ethiopia','et','eth','ኢትዮጵያ')
   and (is_international is null or is_international = false);

-- ─── 005: Multi-tenant bots ────────────────────────────────
alter table businesses
  add column if not exists telegram_bot_token_enc  text,
  add column if not exists telegram_bot_username   varchar(64),
  add column if not exists telegram_bot_id         bigint,
  add column if not exists webhook_secret          varchar(64),
  add column if not exists workspace_type          varchar(16) default 'business'
    check (workspace_type in ('personal','business')),
  add column if not exists plan                    varchar(16) default 'free'
    check (plan in ('free','pro','enterprise')),
  add column if not exists ai_messages_today       integer default 0,
  add column if not exists ai_messages_date        date,
  add column if not exists bot_linked_at           timestamptz,
  add column if not exists bot_last_error          text;

create unique index if not exists idx_businesses_bot_id
  on businesses(telegram_bot_id)
  where telegram_bot_id is not null;

create unique index if not exists idx_businesses_webhook_secret
  on businesses(webhook_secret)
  where webhook_secret is not null;

create index if not exists idx_businesses_workspace
  on businesses(workspace_type);

-- ─── Verify (run this after to confirm) ────────────────────
-- select column_name from information_schema.columns
--  where table_name in ('businesses','suppliers')
--    and column_name in ('telegram_bot_token_enc','webhook_secret','workspace_type','contact_email','currency','is_international')
--  order by table_name, column_name;
