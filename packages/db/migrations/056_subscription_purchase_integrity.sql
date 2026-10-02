-- Immutable server-priced checkouts and atomic, retry-safe fulfillment.
begin;

create table if not exists public.subscription_purchases (
  reference text primary key,
  business_id uuid not null references public.businesses(id),
  provider text not null check (provider in ('stripe', 'chapa')),
  plan text not null check (plan = 'pro'),
  duration_months integer not null check (duration_months in (1, 12)),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('USD', 'ETB')),
  status text not null default 'pending' check (status in ('pending', 'fulfilled')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  granted_until timestamptz
);
alter table public.subscription_purchases enable row level security;
revoke all on public.subscription_purchases from anon, authenticated;
grant select, insert, update on public.subscription_purchases to service_role;

-- These rails already exist in the application. Previously their ledger
-- inserts failed while subscription activation appeared successful.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (
  method in ('telebirr', 'cbe_birr', 'cash', 'bank_transfer', 'chapa', 'stripe', 'paypal')
);

create or replace function public.fulfill_subscription_purchase(
  p_reference text, p_provider text, p_amount_minor bigint, p_currency text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  purchase public.subscription_purchases%rowtype;
  biz public.businesses%rowtype;
  sub public.subscriptions%rowtype;
  expires timestamptz;
begin
  select * into purchase from public.subscription_purchases
    where reference = p_reference for update;
  if not found then raise exception 'Unknown subscription purchase'; end if;
  if p_provider is distinct from purchase.provider
     or p_amount_minor is distinct from purchase.amount_minor
     or p_currency is distinct from purchase.currency then
    raise exception 'Subscription payment mismatch';
  end if;
  if purchase.status = 'fulfilled' then
    return jsonb_build_object('duplicate', true, 'expires_at', purchase.granted_until);
  end if;

  -- Serialize separate renewals for the same business as well as retries.
  select * into biz from public.businesses where id = purchase.business_id for update;
  if not found then raise exception 'Business not found'; end if;
  expires := now();
  if biz.plan_tier = 'pro' and biz.subscription_status = 'active'
      and biz.subscription_expires_at > expires then
    expires := biz.subscription_expires_at;
  end if;
  expires := expires + make_interval(months => purchase.duration_months);

  insert into public.subscriptions
    (user_id, plan_name, credits_total, credits_used, credits_remaining, status,
     started_at, expires_at, payment_reference, updated_at)
    values (purchase.business_id, purchase.plan, -1, 0, -1, 'active', now(), expires, p_reference, now())
    on conflict (user_id) do update set plan_name = excluded.plan_name,
      credits_total = -1, credits_used = 0, credits_remaining = -1,
      status = 'active', expires_at = excluded.expires_at,
      payment_reference = excluded.payment_reference, updated_at = now()
    returning * into sub;

  update public.businesses set subscription_status = 'active', plan_tier = purchase.plan,
    subscription_plan = purchase.plan, subscription_expires_at = expires,
    payment_ref = p_reference, payment_verified = true, payment_method = p_provider,
    payment_notes = 'Verified subscription purchase ' || p_reference
    where id = purchase.business_id;

  insert into public.payments
    (business_id, amount, currency, method, status, direction, reference, description, completed_at)
    values (purchase.business_id, purchase.amount_minor::numeric / 100, purchase.currency,
      p_provider, 'completed', 'inbound', p_reference, 'MiniMe Pro subscription', now());
  update public.subscription_purchases set status = 'fulfilled', fulfilled_at = now(),
    granted_until = expires where reference = p_reference;
  return to_jsonb(sub) || jsonb_build_object('duplicate', false);
end;
$$;
revoke all on function public.fulfill_subscription_purchase(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.fulfill_subscription_purchase(text, text, bigint, text) to service_role;
commit;
