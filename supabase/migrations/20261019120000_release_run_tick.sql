-- Release tick leases early so a killed/finished invocation cannot block
-- the next heartbeat or browser drain for the remainder of lease_until.

CREATE OR REPLACE FUNCTION public.release_run_tick(
  p_kind text,
  p_id uuid
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
    SET tick_lease_until = NULL
    WHERE id = p_id
      AND tick_lease_until IS NOT NULL;
    GET DIAGNOSTICS updated = ROW_COUNT;
  ELSIF p_kind = 'fix' THEN
    UPDATE public.fix_strategies_runs
    SET tick_lease_until = NULL
    WHERE id = p_id
      AND tick_lease_until IS NOT NULL;
    GET DIAGNOSTICS updated = ROW_COUNT;
  ELSIF p_kind = 'e2e' THEN
    UPDATE public.e2e_runs
    SET tick_lease_until = NULL
    WHERE id = p_id
      AND tick_lease_until IS NOT NULL;
    GET DIAGNOSTICS updated = ROW_COUNT;
  ELSE
    RETURN false;
  END IF;
  RETURN updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.release_run_tick(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_run_tick(text, uuid) TO service_role;

COMMENT ON FUNCTION public.release_run_tick(text, uuid) IS
  'Clear tick_lease_until after a tick finishes (or in finally) so the next worker can claim immediately.';
