-- Tasks: Managing the owner's commitments and to-dos
CREATE TABLE IF NOT EXISTS business_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    customer_id TEXT,                   -- Who the task is for
    description TEXT NOT NULL,          -- What needs to be done
    deadline TIMESTAMPTZ,               -- When it's due
    status TEXT DEFAULT 'pending',     -- 'pending', 'completed', 'cancelled'
    priority INT DEFAULT 3,             -- 1 (Urgent) to 5 (Low)
    source_message_id TEXT,             -- Link back to the telegram msg
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    CONSTRAINT fk_biz_task FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- Index for the Owner's Dashboard
CREATE INDEX IF NOT EXISTS idx_tasks_biz_status ON business_tasks(business_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON business_tasks(deadline);
