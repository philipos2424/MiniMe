-- ============================================================
-- 006: Customer orders (checkout flow)
-- A customer messages the bot "I want 2 honey" → an order is created,
-- a Chapa link is sent, and on payment the owner is notified.
-- ============================================================

create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  customer_id       uuid references customers(id) on delete set null,
  conversation_id   uuid references conversations(id) on delete set null,

  -- line items: [{ product_id, name, quantity, unit_price, subtotal }]
  items             jsonb not null default '[]'::jsonb,

  subtotal          numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  currency          varchar(8)   not null default 'ETB',

  status            varchar(24)  not null default 'pending_payment'
    check (status in ('pending_payment','paid','cancelled','fulfilled','refunded','expired')),

  -- Payment
  chapa_tx_ref      varchar(80) unique,
  checkout_url      text,
  payment_method    varchar(24) default 'chapa',
  paid_at           timestamptz,

  -- Fulfillment
  fulfilled_at      timestamptz,
  customer_note     text,
  owner_note        text,

  -- Source
  source            varchar(24) default 'bot'
    check (source in ('bot','web','manual','voice')),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  expires_at        timestamptz default (now() + interval '24 hours')
);

create index if not exists idx_orders_business         on orders(business_id, created_at desc);
create index if not exists idx_orders_customer         on orders(customer_id, created_at desc);
create index if not exists idx_orders_status           on orders(business_id, status);
create index if not exists idx_orders_chapa_ref        on orders(chapa_tx_ref) where chapa_tx_ref is not null;

-- Auto-update updated_at
create or replace function orders_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders
  for each row execute function orders_set_updated_at();
