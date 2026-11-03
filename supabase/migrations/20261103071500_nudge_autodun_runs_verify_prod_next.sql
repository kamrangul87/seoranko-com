-- One-off nudge: resume two stuck autodun runs at production verification.
-- Context: rows are status=running, phase=done, verifiedLive=0, and were never
-- picked up by heartbeat due to scheduling/starvation. Their PRs were merged
-- by the customer on GitHub; do NOT fabricate receipts — only resume verify.
-- Safe: restricts to the exact two known run ids.

BEGIN;

-- Helper: set summary._prevContents.__productionDeployReady = '1'
-- without disturbing other summary fields.
WITH target AS (
  SELECT id, summary
  FROM public.fix_strategies_runs
  WHERE id IN (
    '822585cc-bf14-45d5-9f94-547b6543bb72',
    '703003b7-b597-417a-abd4-a60647c7e688'
  )
)
UPDATE public.fix_strategies_runs r
SET
  phase = 'verify_production_next',
  status = 'running',
  merged_by_customer = COALESCE(merged_by_customer, true),
  error_detail = NULL,
  -- Mark heartbeat freshness so watchdog does not fail immediately.
  updated_at = now(),
  last_progress_at = now(),
  summary = jsonb_set(
    COALESCE(t.summary, '{}'::jsonb),
    ARRAY['_prevContents','__productionDeployReady'],
    to_jsonb('1'::text),
    true
  )
FROM target t
WHERE r.id = t.id;

COMMIT;

