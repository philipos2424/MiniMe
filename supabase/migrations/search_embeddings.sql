-- MiniMe Search Phase 3 — semantic search with pgvector embeddings
-- Run in Supabase SQL Editor (pgvector extension already enabled by migration 003)

-- Add search embedding column to businesses table
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS search_embedding vector(1536);

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_businesses_search_embedding
  ON businesses USING hnsw (search_embedding vector_cosine_ops);

-- RPC: match businesses by embedding similarity (used by search bot)
CREATE OR REPLACE FUNCTION match_businesses_by_search(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  category TEXT,
  tags TEXT[],
  location TEXT,
  address TEXT,
  telegram_bot_username TEXT,
  search_count INT,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    b.id, b.name, b.description, b.category, b.tags,
    b.location, b.address, b.telegram_bot_username, b.search_count,
    1 - (b.search_embedding <=> query_embedding) AS similarity
  FROM businesses b
  WHERE b.b2b_discoverable = true
    AND b.telegram_bot_username IS NOT NULL
    AND b.search_embedding IS NOT NULL
    AND 1 - (b.search_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
