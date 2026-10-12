-- 061_repair_trial_status_sync.sql
-- billing.deductCreditAndLogUsage copied subscriptions.status ('active' by
-- default) onto businesses.subscription_status on every AI reply, leaving
-- these shops on active-with-no-expiry. On main, planStatus() reads that as
-- permanent Pro (unpaid); on feat/swap-barter it reads as no Pro at all (trial
-- lost). Either way the shop is not where it should be. Fixed in code
-- (fix(billing) commit); this puts each affected shop back on its trial if
-- the window is still open, expired otherwise. Every change is written to
-- audit_logs. Run only after the billing fix is deployed.
with affected as (
  select b.id, b.subscription_status as before_status,
         case when b.trial_ends_at > now() then 'trial' else 'expired' end as after_status
  from public.businesses b
  join public.subscriptions s on s.user_id = b.id
  where coalesce(b.plan_tier, 'free') <> 'pro'
    and b.subscription_status = 'active'
    and b.subscription_expires_at is null
    and s.plan_name = 'free'
    and coalesce(b.payment_verified, false) = false
    and b.payment_proof_url is null
), updated as (
  update public.businesses b
     set subscription_status = a.after_status
    from affected a
   where b.id = a.id
  returning b.id, a.before_status, a.after_status
)
insert into public.audit_logs (business_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
select id, 'system', 'migration_061', 'billing.trial_status_repair', 'business', id::text,
       jsonb_build_object('before', before_status, 'after', after_status)
from updated;
