-- Close the Meta webhook dedup race: the pre-insert SELECT on external_id
-- can't stop two concurrent deliveries of the same message. Meta message ids
-- are globally unique, so a partial unique index makes the second insert fail
-- with 23505, which handleMetaMessage treats as "already handled".

-- Remove any duplicates that slipped through before adding the constraint
-- (keep the earliest row).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY created_at ASC) AS rn
  FROM messages
  WHERE external_id IS NOT NULL
)
DELETE FROM messages WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_external_id
  ON messages (external_id)
  WHERE external_id IS NOT NULL;
