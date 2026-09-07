-- 052_conversation_previews.sql
--
-- One correct preview row per conversation for the Chats inbox.
--
-- The inbox previously fetched previews with a single
--   .in('conversation_id', ids).order('created_at' desc).limit(ids.length * 3)
-- which asks for the newest N messages across the WHOLE page, not the newest
-- per conversation. A few chatty threads spend the entire budget: measured on
-- a real 30-row page, only 11 conversations were covered, so 19 rows rendered
-- as "No activity" despite having messages.
--
-- That query also selected file_url / file_type / media_type, none of which
-- exist on public.messages (it has media_url, content_type and telegram_file_*),
-- so PostgREST rejected it outright and every preview came back empty.
--
-- DISTINCT ON (conversation_id) ... ORDER BY conversation_id, created_at DESC
-- is the right shape: exactly one newest row per conversation, no budget to run
-- out of. idx_messages_conversation (conversation_id, created_at DESC) already
-- backs both scans, so no new index is needed.
--
-- Reads run as service_role (see 047_lock_down_anon_access.sql — anon and
-- authenticated hold no grants here and must not gain any through this
-- function), so this is SECURITY INVOKER and EXECUTE is granted only to
-- service_role. p_business_id is required and filtered on in both branches so a
-- caller can never enrich one business's inbox with another's message content.

begin;

create or replace function public.conversation_previews(
  p_business_id uuid,
  p_conversation_ids uuid[]
)
returns table (
  conversation_id uuid,
  content         text,
  direction       text,
  file_url        text,
  file_type       text,
  has_file        boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with last_msg as (
    select distinct on (m.conversation_id)
           m.conversation_id,
           m.content::text   as content,
           m.direction::text as direction
    from messages m
    where m.business_id = p_business_id
      and m.conversation_id = any(p_conversation_ids)
      and m.status in ('sent', 'drafted', 'approved')
    order by m.conversation_id, m.created_at desc
  ),
  last_file as (
    select distinct on (m.conversation_id)
           m.conversation_id,
           m.media_url::text as file_url,
           coalesce(m.telegram_file_type, m.content_type)::text as file_type
    from messages m
    where m.business_id = p_business_id
      and m.conversation_id = any(p_conversation_ids)
      -- A Telegram upload can land with a file id but no stored media_url yet
      -- (16 such rows in production), and the row is still an attachment.
      and (m.media_url is not null or m.telegram_file_id is not null)
    order by m.conversation_id, m.created_at desc
  )
  select
    ids.id                        as conversation_id,
    lm.content,
    lm.direction,
    lf.file_url,
    lf.file_type,
    (lf.conversation_id is not null) as has_file
  from unnest(p_conversation_ids) as ids(id)
  left join last_msg  lm on lm.conversation_id = ids.id
  left join last_file lf on lf.conversation_id = ids.id;
$$;

revoke all on function public.conversation_previews(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.conversation_previews(uuid, uuid[]) to service_role;

commit;
