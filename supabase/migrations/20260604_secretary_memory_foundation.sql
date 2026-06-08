-- Voice Mirror: Learning the owner's communication style
CREATE TABLE IF NOT EXISTS voice_mirror (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    draft_text TEXT NOT NULL,          -- The AI's original suggestion
    corrected_text TEXT NOT NULL,      -- The owner's final version
    style_notes TEXT,                  -- AI-extracted rule (e.g., "User prefers shorter sentences")
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT fk_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- Customer Memories: Long-term relational knowledge
CREATE TABLE IF NOT EXISTS customer_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    customer_id TEXT NOT NULL,          -- Telegram chat ID or unique identifier
    fact TEXT NOT NULL,                -- The actual piece of knowledge
    category TEXT,                     -- 'preference', 'logistics', 'personal', 'financial'
    importance INT DEFAULT 1,          -- 1 (trivia) to 5 (critical)
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_business_mem FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- Indexes for fast retrieval during the reply loop
CREATE INDEX IF NOT EXISTS idx_voice_mirror_biz ON voice_mirror(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_memories_cust ON customer_memories(business_id, customer_id);
