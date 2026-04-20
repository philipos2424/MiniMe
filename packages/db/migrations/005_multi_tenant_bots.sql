-- ============================================================
-- 005: Multi-tenant bots — each user/business brings their own
-- Telegram bot (via @BotFather) and we route updates by token.
-- Also adds a `workspace_type` so the same app serves individuals
-- (personal assistant) and businesses (full CRM + agent).
-- ============================================================

alter table businesses
  add column if not exists telegram_bot_token_enc  text,
  add column if not exists telegram_bot_username   varchar(64),
  add column if not exists telegram_bot_id         bigint,
  add column if not exists webhook_secret          varchar(64),      -- set-webhook secret_token (random uuid-ish)
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
