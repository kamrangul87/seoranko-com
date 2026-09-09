-- Hosted causal_results may have been stub-created without the
-- UNIQUE (intervention_id, metric, is_exploratory) from the PR2 migration
-- (CREATE TABLE IF NOT EXISTS is a no-op on stubs). Ensure the idempotency
-- key exists so ON CONFLICT upserts work.

CREATE UNIQUE INDEX IF NOT EXISTS causal_results_intervention_metric_exploratory_key
  ON causal_results (intervention_id, metric, is_exploratory);
