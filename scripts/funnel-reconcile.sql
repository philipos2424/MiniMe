-- funnel-reconcile.sql — manual SQL counts to check the weekly funnel report
-- against (pricing & funnel spec §1: "numbers reconcile with a manual SQL
-- count"). Read-only. Run in the Supabase SQL editor after the first
-- /api/cron/funnel-weekly run and compare with the report's "all time"
-- column.
--
-- The two "real customer" rules below mirror lib/server/funnel/events.mjs:
-- the customer is not the shop owner and not a sub-admin. The app also
-- excludes platform admin Telegram ids (ADMIN_TELEGRAM_IDS env) — put them
-- in the admin_ids CTE to match exactly.

with admin_ids(telegram_id) as (
  -- e.g. values (111111111::bigint), (222222222::bigint)
  select null::bigint where false
),
shops as (
  select * from businesses where is_internal is not true
),
real_inbound as (
  select m.business_id, m.created_at
  from messages m
  join shops b on b.id = m.business_id
  left join customers c on c.id = m.customer_id
  where m.direction = 'inbound'
    and (c.telegram_id is null or (
          c.telegram_id is distinct from b.owner_telegram_id
      and not (c.telegram_id = any (coalesce(b.sub_admin_telegram_ids, '{}')))
      and c.telegram_id not in (select telegram_id from admin_ids)
    ))
)
select 'shops (all)'                         as metric, count(*) as manual, null::bigint as funnel_events from businesses
union all
select 'test shops excluded',                count(*), null from businesses where is_internal is true
union all
select 'registered',                         (select count(*) from shops),
       (select count(distinct business_id) from funnel_events where event = 'registered')
union all
select 'onboarding_completed',               (select count(*) from shops where onboarding_completed),
       (select count(distinct business_id) from funnel_events where event = 'onboarding_completed')
union all
select 'first_customer_message',             (select count(distinct business_id) from real_inbound),
       (select count(distinct business_id) from funnel_events where event = 'first_customer_message')
union all
select 'shops with a real customer message in last 30 days',
       (select count(distinct business_id) from real_inbound where created_at >= now() - interval '30 days'), null
union all
select 'payment_confirmed (shops)',
       (select count(distinct se.business_id) from subscription_events se join shops b on b.id = se.business_id
         where se.event = 'subscribed' and coalesce(se.meta->>'source', '') not in ('admin_edit', 'bulk_activate')),
       (select count(distinct business_id) from funnel_events where event = 'payment_confirmed')
union all
select 'activated',                          null,
       (select count(distinct business_id) from funnel_events where event = 'activated');

-- Funnel rows that belong to shops since marked internal. The report ignores
-- them; this should stay small.
-- select count(*) from funnel_events f join businesses b on b.id = f.business_id where b.is_internal is true;
