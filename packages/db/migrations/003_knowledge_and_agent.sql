-- =====================================================================
-- MiniMe migration 003: knowledge base (RAG) + agent memory + scheduling
-- Run this in Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1) Enable pgvector for semantic search
create extension if not exists vector;

-- 2) Documents uploaded per workspace/business
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  title varchar(255) not null,
  tag varchar(60),                 -- price-list, menu, brochure, terms, faq, catalog, other
  description text,                 -- human description used for retrieval matching
  mime_type varchar(120),
  storage_path text,                -- path in Supabase Storage (bucket: documents)
  original_filename text,
  byte_size bigint,
  page_count int,
  status varchar(20) default 'pending' check (status in ('pending','extracting','embedding','ready','failed')),
  error text,
  enabled boolean default true,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_documents_business on documents(business_id, enabled);
create index if not exists idx_documents_tag on documents(business_id, tag);

-- 3) Document chunks with embeddings (text-embedding-3-small = 1536 dims)
create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  token_count int,
  embedding vector(1536),
  created_at timestamptz default now()
);
create index if not exists idx_document_chunks_doc on document_chunks(document_id);
create index if not exists idx_document_chunks_biz on document_chunks(business_id);
-- HNSW vector index for fast similarity search
create index if not exists idx_document_chunks_embedding
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- 4) Per-customer agent memory (not just global advisor memory)
create table if not exists customer_memory (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  kind varchar(40) not null,     -- preference, fact, commitment, note
  content text not null,
  source varchar(40),             -- advisor, customer_msg, owner_note, auto_extracted
  created_at timestamptz default now(),
  unique (customer_id, kind, content)
);
create index if not exists idx_customer_memory on customer_memory(customer_id, business_id);

-- 5) Extend agent_tasks to support reminders / scheduled messages
alter table agent_tasks
  drop constraint if exists agent_tasks_type_check;
alter table agent_tasks
  add constraint agent_tasks_type_check check (type in (
    'supply_reorder', 'delivery_schedule', 'payment_followup',
    'inventory_check', 'customer_followup', 'price_update',
    'reminder', 'scheduled_message', 'followup', 'broadcast', 'briefing'
  ));
alter table agent_tasks
  add column if not exists scheduled_at timestamptz;
alter table agent_tasks
  add column if not exists customer_id uuid references customers(id) on delete set null;
alter table agent_tasks
  add column if not exists fired_at timestamptz;
create index if not exists idx_agent_tasks_schedule on agent_tasks(business_id, status, scheduled_at);

-- 6) Agent-level persistent memory on businesses (global context the agent has learned)
alter table businesses
  add column if not exists agent_memory jsonb default '[]'::jsonb;

-- 7) Semantic search RPC — used by the knowledge service
create or replace function match_document_chunks(
  query_embedding vector(1536),
  p_business_id uuid,
  match_threshold float default 0.3,
  match_count int default 5
) returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql stable as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from document_chunks c
  join documents d on d.id = c.document_id
  where c.business_id = p_business_id
    and d.enabled = true
    and d.status = 'ready'
    and (1 - (c.embedding <=> query_embedding)) > match_threshold
  order by c.embedding <=> query_embedding asc
  limit match_count
$$;

-- 8) Match whole documents (for auto-send on request)
create or replace function match_documents(
  query_embedding vector(1536),
  p_business_id uuid,
  match_threshold float default 0.4,
  match_count int default 3
) returns table (
  document_id uuid,
  title varchar,
  tag varchar,
  description text,
  storage_path text,
  mime_type varchar,
  similarity float
)
language sql stable as $$
  select
    d.id as document_id,
    d.title,
    d.tag,
    d.description,
    d.storage_path,
    d.mime_type,
    max(1 - (c.embedding <=> query_embedding)) as similarity
  from documents d
  join document_chunks c on c.document_id = d.id
  where d.business_id = p_business_id
    and d.enabled = true
    and d.status = 'ready'
  group by d.id
  having max(1 - (c.embedding <=> query_embedding)) > match_threshold
  order by similarity desc
  limit match_count
$$;

-- 9) Policies (service role has full access on new tables)
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table customer_memory enable row level security;
drop policy if exists "service_all_documents" on documents;
drop policy if exists "service_all_chunks" on document_chunks;
drop policy if exists "service_all_memory" on customer_memory;
create policy "service_all_documents" on documents for all using (true) with check (true);
create policy "service_all_chunks" on document_chunks for all using (true) with check (true);
create policy "service_all_memory" on customer_memory for all using (true) with check (true);

-- 10) Storage bucket for uploaded files (must also be created via Storage UI or next call)
-- Run once in Supabase SQL editor if not already:
-- insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict do nothing;
