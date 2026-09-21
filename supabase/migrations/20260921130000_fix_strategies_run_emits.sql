-- Stage page-level detector emits for a crawl run so rollup can span chunks.
CREATE TABLE IF NOT EXISTS fix_strategies_run_emits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_run_emits_run
  ON fix_strategies_run_emits(run_id);

ALTER TABLE fix_strategies_run_emits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own run emits" ON fix_strategies_run_emits;
CREATE POLICY "Users select own run emits"
  ON fix_strategies_run_emits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM fix_strategies_crawl_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );
