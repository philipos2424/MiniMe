-- How the search reached us: 'text' (typed) or 'voice' (Telegram voice note).
-- Until this is applied, search_logs inserts that include `via` fail silently
-- (they are fire-and-forget) — run this before deploying the searchBot change.
alter table search_logs add column if not exists via text default 'text';
