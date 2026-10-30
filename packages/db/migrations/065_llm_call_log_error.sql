-- Migration 065: keep why an AI provider call failed
--
-- 55-70% of llm_call_log rows were ok=false every day (Gemini failing almost
-- always in the nightly jobs), and the reason lived only in runtime logs kept
-- for one hour. openaiClient.js now records "<status> <message>" here.
-- Additive; logCall retries without the column if it's missing.
ALTER TABLE llm_call_log ADD COLUMN IF NOT EXISTS error TEXT;
