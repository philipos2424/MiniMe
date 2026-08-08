-- llm_call_log: record the two token classes that actually drive OpenAI cost.
--
-- Why: gpt-5.x bills hidden "reasoning" tokens at output rates, and discounts
-- "cached" prompt tokens. Neither was recorded, so the cost dashboards showed a
-- number that couldn't be acted on — you could see a route was expensive but not
-- whether it was expensive because of reasoning (fixable with reasoning_effort)
-- or because of an uncached prompt prefix (fixable by reordering the prompt).
--
-- Both are nullable: rows written before this migration keep NULL, and the
-- non-OpenAI fallback providers (Groq/Gemini/Ollama) don't report them at all.
-- Do NOT default these to 0 — that would make "provider didn't report it"
-- indistinguishable from "genuinely zero", which is the exact signal we want.

alter table public.llm_call_log
  add column if not exists cached_tokens    integer,
  add column if not exists reasoning_tokens integer;

comment on column public.llm_call_log.cached_tokens is
  'usage.prompt_tokens_details.cached_tokens — prompt tokens served from OpenAI''s prefix cache (billed at a discount). Subset of prompt_tokens. NULL = provider did not report it.';
comment on column public.llm_call_log.reasoning_tokens is
  'usage.completion_tokens_details.reasoning_tokens — hidden reasoning tokens, billed at output rates. Subset of completion_tokens. NULL = provider did not report it.';

-- Cost queries filter by route + recency; maybeAutoRollback already reads this
-- shape on every failed call.
create index if not exists llm_call_log_route_created_idx
  on public.llm_call_log (route, created_at desc);
