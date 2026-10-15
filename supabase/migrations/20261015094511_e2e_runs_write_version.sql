-- Integer CAS token for e2e_runs updates. timestamptz equality via PostgREST
-- is fragile (offset/precision), which left reset_seed stuck running after the
-- GitHub reset commit had already landed (#227).
ALTER TABLE public.e2e_runs
  ADD COLUMN IF NOT EXISTS write_version bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.e2e_runs.write_version IS
  'Monotonic CAS token; updateE2eRun increments on every successful write.';
