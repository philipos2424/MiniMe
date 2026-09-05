-- 046_rate_limit_atomic.sql
--
-- Make rate limiting authoritative across serverless instances.
--
-- The app's rateLimit() decided `ok` from an in-process Map, which every
-- Vercel cold start reset to zero — so per-IP caps (admin-login brute force,
-- payment-proof spam) were effectively per-lambda, not global. An attacker
-- spraying requests hits many fresh instances and never trips the cap.
--
-- This function does the check-and-increment in one atomic statement inside
-- Postgres. INSERT ... ON CONFLICT DO UPDATE takes a row lock, so concurrent
-- lambdas serialize on the same key — no read-then-write race can let a burst
-- slip past the limit. It also rolls the window over when reset_at has passed,
-- so a single call both expires the old window and counts the new request.
--
-- Returns the post-increment count, the window's reset time, and whether this
-- request is within the cap.

CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_key         text,
  p_max         integer,
  p_window_secs integer
)
RETURNS TABLE(count integer, reset_at timestamptz, allowed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now   timestamptz := now();
  v_count integer;
  v_reset timestamptz;
BEGIN
  INSERT INTO rate_limits (key, count, max_requests, reset_at, updated_at)
  VALUES (
    p_key,
    1,
    p_max,
    v_now + make_interval(secs => p_window_secs),
    v_now
  )
  ON CONFLICT (key) DO UPDATE SET
    -- Window expired → start a fresh window at 1. Otherwise increment.
    count = CASE WHEN rate_limits.reset_at <= v_now THEN 1
                 ELSE rate_limits.count + 1 END,
    reset_at = CASE WHEN rate_limits.reset_at <= v_now
                    THEN v_now + make_interval(secs => p_window_secs)
                    ELSE rate_limits.reset_at END,
    max_requests = p_max,
    updated_at = v_now
  RETURNING rate_limits.count, rate_limits.reset_at
    INTO v_count, v_reset;

  RETURN QUERY SELECT v_count, v_reset, (v_count <= p_max);
END;
$$;

-- Only the service role reaches this (same as the table).
NOTIFY pgrst, 'reload schema';
