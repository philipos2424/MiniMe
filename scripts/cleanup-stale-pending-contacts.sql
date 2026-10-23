-- Clear "New contact" threads that were held (secretary ask_first) and never
-- classified. 809 of 1,450 across connected accounts were > 7 days old on
-- 2026-10-23; nothing ever expired them. The webhook now prunes at write time
-- (contactRules.prunePending: 48h, newest 50), but only for accounts that
-- receive a new contact message — this clears the rest.
--
-- NOT a migration on purpose: run by hand, dry-run first.
-- It only removes pending_contacts entries. It sends nothing to anyone, and
-- never touches personal_contacts, contact_rules, customers or messages.

-- 1) DRY RUN — how many entries would go, and from how many businesses
with e as (
  select b.id, v.key, v.value as ent
  from businesses b, jsonb_each(coalesce(b.notification_prefs->'pending_contacts','{}'::jsonb)) v
)
select count(*) as entries_to_remove, count(distinct id) as businesses
from e
where coalesce((ent->>'at')::timestamptz, (ent->>'asked_at')::timestamptz, 'epoch') < now() - interval '48 hours';

-- 2) APPLY (uncomment after reviewing the numbers above)
-- update businesses b
-- set notification_prefs = jsonb_set(
--   b.notification_prefs, '{pending_contacts}',
--   coalesce((
--     select jsonb_object_agg(v.key, v.value)
--     from jsonb_each(b.notification_prefs->'pending_contacts') v
--     where coalesce((v.value->>'at')::timestamptz, (v.value->>'asked_at')::timestamptz, 'epoch') >= now() - interval '48 hours'
--   ), '{}'::jsonb)
-- )
-- where jsonb_typeof(b.notification_prefs->'pending_contacts') = 'object'
--   and b.notification_prefs->'pending_contacts' <> '{}'::jsonb;
