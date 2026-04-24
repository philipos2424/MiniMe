-- 010_message_attachments.sql — Keep the Telegram file_id on inbound messages.
--
-- Before this, we only saved the transcribed/analyzed text of a customer's
-- photo or PDF — the actual file_id was thrown away. That meant the Agent
-- couldn't forward the file to a supplier later. We now store file_id +
-- type + filename so the fan-out engine can re-send via sendPhoto /
-- sendDocument without re-downloading anything.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS telegram_file_id   VARCHAR(255);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS telegram_file_type VARCHAR(16);   -- photo | document | voice | video
ALTER TABLE messages ADD COLUMN IF NOT EXISTS telegram_file_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_messages_customer_files
  ON messages(customer_id, created_at DESC)
  WHERE telegram_file_id IS NOT NULL;
