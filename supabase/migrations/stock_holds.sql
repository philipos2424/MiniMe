-- ============================================================
-- Stock holds — availability across conversations
--
-- products.stock_quantity does not move until Chapa confirms a payment, so two
-- customers in two separate chats were both told "1 left" for the same last
-- unit and both could order it.
--
-- A hold is not a new record: it is an unpaid, unexpired order (status
-- pending_payment, expires_at in the future — orders default to 24h). That
-- keeps one source of truth, and makes releasing a hold nothing more than the
-- order expiring or being cancelled.
--
--   available = products.stock_quantity - held_quantities.held
--
-- Note the expires_at filter below: availability is correct the moment a hold
-- lapses, whether or not the expire-orders cron has flipped the row's status
-- yet. The cron is data hygiene, not a precondition for stock coming back.
--
-- Safe to re-run.
-- ============================================================

-- Reads are per-business and only ever touch unpaid orders, which are a small
-- slice of the table.
create index if not exists idx_orders_active_holds
  on orders(business_id)
  where status = 'pending_payment';

create or replace function held_quantities(p_business_id uuid)
returns table (product_id uuid, held numeric)
language sql
stable
as $$
  with active as materialized (
    -- Rows are filtered to real jsonb arrays HERE, in their own scan, before
    -- anything tries to unnest them. Folded into the query below, the lateral
    -- is not guaranteed to run after the type guard, and one malformed items
    -- value would error the whole call for that business.
    select o.items
    from orders o
    where o.business_id = p_business_id
      and o.status = 'pending_payment'
      and (o.expires_at is null or o.expires_at > now())
      and jsonb_typeof(o.items) = 'array'
  ),
  line_items as materialized (
    select it->>'product_id' as pid,
           coalesce((it->>'quantity')::numeric, 0) as qty
    from active
    cross join lateral jsonb_array_elements(active.items) as it
    -- Free-form brain orders ("2 custom cards") carry no product_id and hold
    -- nothing — there is no catalog row for them to hold against. The regex
    -- also keeps a malformed id from failing the ::uuid cast below for every
    -- other order in the business.
    where it->>'product_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  )
  select pid::uuid as product_id, sum(qty) as held
  from line_items
  group by pid
  having sum(qty) > 0
$$;

grant execute on function held_quantities(uuid) to anon, authenticated, service_role;
