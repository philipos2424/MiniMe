-- 047_lock_down_anon_access.sql
--
-- Closes a live data exposure found on 2026-08-31.
--
-- The Supabase *anon* JWT is compiled into the public client bundle (normal —
-- an anon key is only ever as safe as the RLS behind it). Two separate holes
-- meant that key had full read/write/delete over essentially the whole schema:
--
--   1. Five tables ran with RLS switched off entirely: orders (customer
--      delivery_lat/lng!), llm_route_state (writing forced_model repoints the
--      platform's model routing), shopping_sessions, llm_call_log,
--      funnel_events.
--
--   2. Fourteen policies named "Service role full access" / "service_all_*"
--      were granted `TO public USING (true)`, not `TO service_role`. Every
--      role — anon included — is a member of `public`, so RLS was enabled on
--      businesses, messages, customers, conversations, products, documents,
--      document_chunks, payments and more, and then waved everyone through.
--      Only ai_usage and subscriptions scoped their policy correctly.
--
-- On top of both, every table in `public` granted anon and authenticated the
-- full ALL privilege set including TRUNCATE.
--
-- Safe to apply: nothing reads with the anon key. apps/web/src/lib/server/db.js
-- and packages/db/client.js both use SUPABASE_SERVICE_ROLE_KEY, which bypasses
-- RLS. The only two anon-key modules (lib/supabase-browser.js,
-- lib/supabase-server.js) have zero importers — the client-side queries they
-- served were already moved behind API routes (see api/admin/search-metrics).

begin;

-- ── 1. Drop the policies that granted `public` (i.e. anon) full access ──────
-- service_role bypasses RLS, so these policies were never needed for the app
-- to work; they only ever widened the door. Dropping beats rewriting them
-- `TO service_role`, which would be a no-op policy.
drop policy if exists "Service role full access"      on public.businesses;
drop policy if exists "Service role full access"      on public.messages;
drop policy if exists "Service role full access"      on public.customers;
drop policy if exists "Service role full access"      on public.conversations;
drop policy if exists "Service role full access"      on public.products;
drop policy if exists "Service role full access"      on public.payments;
drop policy if exists "Service role full access"      on public.suppliers;
drop policy if exists "Service role full access"      on public.feedback;
drop policy if exists "Service role full access"      on public.daily_analytics;
drop policy if exists "Service role full access"      on public.onboarding_responses;
drop policy if exists "Service role full access"      on public.agent_tasks;
drop policy if exists "service_all_documents"         on public.documents;
drop policy if exists "service_all_chunks"            on public.document_chunks;
drop policy if exists "service_all_memory"            on public.customer_memory;

-- ── 2. Turn RLS on where it was never enabled ──────────────────────────────
alter table public.orders            enable row level security;
alter table public.shopping_sessions enable row level security;
alter table public.llm_call_log      enable row level security;
alter table public.llm_route_state   enable row level security;
alter table public.funnel_events     enable row level security;

-- ── 3. Enable RLS on every remaining public table, defensively ─────────────
-- Catches anything created since without it. Deny-all-by-default (RLS on, no
-- policy) is the correct posture here because the only client is service_role.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- ── 4. Revoke the blanket anon / authenticated grants ──────────────────────
-- Belt and braces: with RLS on and no permissive policy these roles could not
-- read rows anyway, but removing the grant means PostgREST won't even expose
-- the tables, and a future policy added by mistake can't reopen them.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- ── 5. Stop new objects from inheriting those grants ───────────────────────
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

commit;
