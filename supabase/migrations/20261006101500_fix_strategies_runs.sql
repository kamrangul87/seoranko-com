-- One-run Fix Agent: batch auto-fixable findings into a single PR.
-- Writes go through service role; authenticated users may SELECT their own runs.

CREATE TABLE IF NOT EXISTS fix_strategies_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued',
      'running',
      'awaiting_approval',
      'merging',
      'complete',
      'failed'
    )),
  phase TEXT NOT NULL DEFAULT 'create_branch'
    CHECK (phase IN (
      'create_branch',
      'apply_next',
      'ensure_pr',
      'wait_preview',
      'verify_preview_next',
      'await_approval',
      'merge',
      'verify_production_next',
      'recrawl',
      'done'
    )),
  branch_name TEXT NULL,
  pr_number INT NULL,
  pr_url TEXT NULL,
  preview_url TEXT NULL,
  merge_sha TEXT NULL,
  approved_at TIMESTAMPTZ NULL,
  auto_merge_attempted BOOLEAN NOT NULL DEFAULT false,
  auto_merge_blocked_reason TEXT NULL,
  item_cursor INT NOT NULL DEFAULT 0,
  error_detail TEXT NULL,
  summary JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_runs_user ON fix_strategies_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_fs_runs_site ON fix_strategies_runs(site_id);
CREATE INDEX IF NOT EXISTS idx_fs_runs_status ON fix_strategies_runs(status);

CREATE TABLE IF NOT EXISTS fix_strategies_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES fix_strategies_runs(id) ON DELETE CASCADE,
  finding_id UUID NOT NULL REFERENCES fix_strategies_findings(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'applying',
      'committed',
      'preview_verified',
      'failed',
      'production_verified',
      'verified_live',
      'noop'
    )),
  commit_sha TEXT NULL,
  path TEXT NULL,
  preview_verified_at TIMESTAMPTZ NULL,
  production_verified_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_fs_run_items_run ON fix_strategies_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_fs_run_items_finding ON fix_strategies_run_items(finding_id);
CREATE INDEX IF NOT EXISTS idx_fs_run_items_status ON fix_strategies_run_items(status);

ALTER TABLE fix_strategies_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_strategies_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own fix runs" ON fix_strategies_runs;
CREATE POLICY "Users read own fix runs"
  ON fix_strategies_runs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own fix run items" ON fix_strategies_run_items;
CREATE POLICY "Users read own fix run items"
  ON fix_strategies_run_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM fix_strategies_runs r
      WHERE r.id = fix_strategies_run_items.run_id
        AND r.user_id = auth.uid()
    )
  );

REVOKE ALL ON fix_strategies_runs FROM anon, authenticated;
REVOKE ALL ON fix_strategies_run_items FROM anon, authenticated;
GRANT SELECT ON fix_strategies_runs TO authenticated;
GRANT SELECT ON fix_strategies_run_items TO authenticated;

COMMENT ON TABLE fix_strategies_runs IS
  'One-run Fix Agent: one branch + one PR for all auto-fixable findings on a site.';
COMMENT ON TABLE fix_strategies_run_items IS
  'Per-finding progress inside a fix_strategies_runs batch.';
