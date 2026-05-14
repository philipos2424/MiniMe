CREATE TABLE IF NOT EXISTS pending_edits (
    chat_id BIGINT PRIMARY KEY,
    message_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
