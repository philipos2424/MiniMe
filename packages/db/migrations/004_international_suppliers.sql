-- ============================================================
-- 004: International suppliers
-- Extend the suppliers table to support cross-border vendors
-- (email contact, country, currency, MOQ, payment terms, etc.)
-- ============================================================

alter table suppliers
  add column if not exists contact_email      varchar(255),
  add column if not exists country            varchar(80),     -- e.g. "China", "Turkey", "UAE"
  add column if not exists country_code       varchar(8),      -- ISO-3166 alpha-2/3
  add column if not exists currency           varchar(8) default 'ETB',
  add column if not exists website_url        text,
  add column if not exists whatsapp_number    varchar(50),
  add column if not exists wechat_id          varchar(120),
  add column if not exists preferred_channel  varchar(20) default 'telegram'
    check (preferred_channel in ('telegram','email','whatsapp','wechat','phone','manual')),
  add column if not exists language           varchar(8)  default 'en',
  add column if not exists min_order_quantity integer,
  add column if not exists lead_time_days     integer,        -- supersedes avg_delivery_days for international
  add column if not exists payment_terms      text,           -- "30% advance / 70% before shipment"
  add column if not exists incoterms          varchar(16),    -- FOB, CIF, EXW, DDP...
  add column if not exists is_international   boolean default false;

create index if not exists idx_suppliers_business_intl
  on suppliers(business_id, is_international);

-- Backfill: any supplier with a country other than Ethiopia should be flagged
update suppliers
   set is_international = true
 where country is not null
   and lower(country) not in ('ethiopia','et','eth','ኢትዮጵያ')
   and (is_international is null or is_international = false);
