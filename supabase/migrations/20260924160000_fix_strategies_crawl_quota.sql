-- Durable, cross-isolate daily crawl-start quota.
--
-- assertCrawlStartAllowed()/recordCrawlStart() were backed by a plain
-- in-process Map (src/lib/fix-strategies/findings-ui/crawl/rate-limit.ts),
-- scoped per serverless isolate. On Vercel, each lambda instance has its
-- own memory, so the "5/day free, 50/day subscribed" billing limits were
-- never actually enforced across separate invocations — a user's own
-- manual crawls landing on different cold starts, or a scheduled sweep
-- running alongside them, would not see each other's counts at all.

CREATE TABLE IF NOT EXISTS fix_strategies_crawl_daily_starts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE fix_strategies_crawl_daily_starts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own crawl quota" ON fix_strategies_crawl_daily_starts;
CREATE POLICY "Users read own crawl quota"
ON fix_strategies_crawl_daily_starts FOR SELECT
USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policy for authenticated — writes only ever
-- happen through the SECURITY DEFINER functions below (service role),
-- matching the write pattern used across the other fix_strategies_* tables.

-- Atomically reserves one crawl-start slot for (user, UTC day) and reports
-- whether it was allowed. A single `UPDATE ... WHERE count < p_limit
-- RETURNING` is race-free by construction — concurrent callers serialize
-- on Postgres's row-level lock for that (user_id, day) row, so only
-- requests that are genuinely under the limit at their turn succeed, in
-- order, with no lost updates and no double-allow window. This is what a
-- SELECT-then-UPDATE version (or the old in-memory Map) does not
-- guarantee.
CREATE OR REPLACE FUNCTION fix_strategies_try_reserve_crawl_start(
  p_user_id UUID,
  p_limit INTEGER
)
RETURNS TABLE(allowed BOOLEAN, count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO fix_strategies_crawl_daily_starts (user_id, day, count, updated_at)
  VALUES (p_user_id, (NOW() AT TIME ZONE 'utc')::date, 0, NOW())
  ON CONFLICT (user_id, day) DO NOTHING;

  UPDATE fix_strategies_crawl_daily_starts
  SET count = fix_strategies_crawl_daily_starts.count + 1, updated_at = NOW()
  WHERE user_id = p_user_id
    AND day = (NOW() AT TIME ZONE 'utc')::date
    AND fix_strategies_crawl_daily_starts.count < p_limit
  RETURNING fix_strategies_crawl_daily_starts.count INTO v_count;

  IF v_count IS NULL THEN
    SELECT fix_strategies_crawl_daily_starts.count INTO v_count
    FROM fix_strategies_crawl_daily_starts
    WHERE user_id = p_user_id AND day = (NOW() AT TIME ZONE 'utc')::date;
    RETURN QUERY SELECT false, COALESCE(v_count, 0);
  ELSE
    RETURN QUERY SELECT true, v_count;
  END IF;
END;
$$;

-- Compensating release for when a reservation was made but the crawl
-- failed to actually start (e.g. startCrawlRun throws) — a transient
-- error must not permanently burn a real quota slot.
CREATE OR REPLACE FUNCTION fix_strategies_release_crawl_start(
  p_user_id UUID
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE fix_strategies_crawl_daily_starts
  SET count = GREATEST(count - 1, 0), updated_at = NOW()
  WHERE user_id = p_user_id AND day = (NOW() AT TIME ZONE 'utc')::date;
$$;

REVOKE ALL ON FUNCTION fix_strategies_try_reserve_crawl_start(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION fix_strategies_release_crawl_start(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fix_strategies_try_reserve_crawl_start(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION fix_strategies_release_crawl_start(UUID) TO service_role;

COMMENT ON TABLE fix_strategies_crawl_daily_starts IS
  'Durable per-user daily crawl-start counter, replacing the old in-process-per-isolate Map. Write only via fix_strategies_try_reserve_crawl_start / fix_strategies_release_crawl_start (service role, SECURITY DEFINER).';
