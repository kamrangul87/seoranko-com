-- Minute heartbeat for unfinished crawl / fix / e2e runs via pg_cron + pg_net.
-- Progress must not depend on browser tabs, deploys, or in-process waitUntil timers.
-- Requires vault secret name = heartbeat_cron_secret (value = CRON_SECRET).
--
-- pg_cron / pg_net must already be enabled on the hosted project (Dashboard →
-- Database → Extensions). CREATE EXTENSION / GRANT for pg_cron fails on
-- Supabase with SQLSTATE 0LP01 when the migration role re-grants to itself.

-- Lease + progress columns (additive).
ALTER TABLE public.fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS tick_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

ALTER TABLE public.fix_strategies_runs
  ADD COLUMN IF NOT EXISTS tick_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

ALTER TABLE public.e2e_runs
  ADD COLUMN IF NOT EXISTS tick_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

UPDATE public.fix_strategies_crawl_runs
SET last_progress_at = COALESCE(last_progress_at, updated_at, now())
WHERE last_progress_at IS NULL;

UPDATE public.fix_strategies_runs
SET last_progress_at = COALESCE(last_progress_at, updated_at, now())
WHERE last_progress_at IS NULL;

UPDATE public.e2e_runs
SET last_progress_at = COALESCE(last_progress_at, updated_at, now())
WHERE last_progress_at IS NULL;

COMMENT ON COLUMN public.fix_strategies_crawl_runs.tick_lease_until IS
  'Heartbeat CAS lease; prevents concurrent ticks.';
COMMENT ON COLUMN public.fix_strategies_crawl_runs.last_progress_at IS
  'Last advanced tick; watchdog fails after 15 minutes without progress.';
COMMENT ON COLUMN public.fix_strategies_runs.tick_lease_until IS
  'Heartbeat CAS lease; prevents concurrent ticks.';
COMMENT ON COLUMN public.fix_strategies_runs.last_progress_at IS
  'Last advanced tick; watchdog fails after 15 minutes without progress.';
COMMENT ON COLUMN public.e2e_runs.tick_lease_until IS
  'Heartbeat CAS lease; prevents concurrent ticks.';
COMMENT ON COLUMN public.e2e_runs.last_progress_at IS
  'Last advanced tick; watchdog fails after 15 minutes without progress.';

-- CAS claim used by the app (and available for SQL). Returns true if this caller won the lease.
CREATE OR REPLACE FUNCTION public.claim_run_tick(
  p_kind text,
  p_id uuid,
  p_lease_until timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated int := 0;
BEGIN
  IF p_kind = 'crawl' THEN
    UPDATE public.fix_strategies_crawl_runs
    SET tick_lease_until = p_lease_until
    WHERE id = p_id
      AND (tick_lease_until IS NULL OR tick_lease_until < now());
    GET DIAGNOSTICS updated = ROW_COUNT;
  ELSIF p_kind = 'fix' THEN
    UPDATE public.fix_strategies_runs
    SET tick_lease_until = p_lease_until
    WHERE id = p_id
      AND (tick_lease_until IS NULL OR tick_lease_until < now());
    GET DIAGNOSTICS updated = ROW_COUNT;
  ELSIF p_kind = 'e2e' THEN
    UPDATE public.e2e_runs
    SET tick_lease_until = p_lease_until
    WHERE id = p_id
      AND (tick_lease_until IS NULL OR tick_lease_until < now());
    GET DIAGNOSTICS updated = ROW_COUNT;
  ELSE
    RETURN false;
  END IF;
  RETURN updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_run_tick(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_run_tick(text, uuid, timestamptz) TO service_role;

-- HTTP invoke of the heartbeat endpoint (reads CRON_SECRET from vault).
CREATE OR REPLACE FUNCTION public.invoke_run_heartbeat()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, vault
AS $$
DECLARE
  secret text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret
  FROM vault.decrypted_secrets
  WHERE name = 'heartbeat_cron_secret'
  LIMIT 1;

  IF secret IS NULL OR length(secret) = 0 THEN
    RAISE WARNING 'invoke_run_heartbeat: vault secret heartbeat_cron_secret missing';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://www.seoranko.com/api/internal/heartbeat',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_run_heartbeat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_run_heartbeat() TO postgres;

-- Schedule every minute (Supabase pg_cron; not a Vercel cron — Hobby-safe).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'seoranko-run-heartbeat';
EXCEPTION
  WHEN undefined_table THEN
    NULL;
  WHEN undefined_function THEN
    NULL;
END $$;

SELECT cron.schedule(
  'seoranko-run-heartbeat',
  '* * * * *',
  $$SELECT public.invoke_run_heartbeat();$$
);
