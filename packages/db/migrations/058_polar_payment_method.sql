-- 058: allow Polar in the payments ledger.
--
-- Polar checkout (merged from main) records its fulfilled orders with
-- method = 'polar'. 056 rebuilt payments_method_check without it, so those
-- ledger inserts were rejected while the subscription itself activated.

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (
  method in ('telebirr', 'cbe_birr', 'cash', 'bank_transfer', 'chapa', 'stripe', 'paypal', 'polar')
);
