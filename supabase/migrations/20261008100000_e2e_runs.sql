-- Fix Agent permanent e2e runs.
-- Written by service role from cron/admin routes; master access is enforced
-- in the Next.js API (requireMasterUser), not via JWT email matching in RLS.

CREATE TABLE IF NOT EXISTS public.e2e_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'fix_agent_fixture',
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'passed', 'failed')),
  current_step text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_failing_step text,
  fail_reason text,
  site_id uuid,
  fix_run_id uuid,
  crawl_run_id uuid,
  seed_sha text,
  merge_sha text,
  consecutive_pass_days integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS e2e_runs_started_at_idx ON public.e2e_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS e2e_runs_status_idx ON public.e2e_runs (status);

ALTER TABLE public.e2e_runs ENABLE ROW LEVEL SECURITY;

-- No direct client access — API uses service role after requireMasterUser.
REVOKE ALL ON public.e2e_runs FROM anon, authenticated;
GRANT ALL ON public.e2e_runs TO service_role;

COMMENT ON TABLE public.e2e_runs IS
  'Fix Agent fixture e2e results; service-role writes; master reads via admin API.';
