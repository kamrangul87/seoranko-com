-- Persist Findings UI fix-flow sessions (approve → commit → verify).
-- Replaces process-memory Map so serverless ticks share state.

CREATE TABLE IF NOT EXISTS fix_strategies_fix_flows (
  finding_id UUID PRIMARY KEY
    REFERENCES fix_strategies_findings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step TEXT NOT NULL DEFAULT 'idle'
    CHECK (step IN ('idle', 'approved', 'committed', 'verified', 'failed')),
  approved_at TIMESTAMPTZ NULL,
  committed_at TIMESTAMPTZ NULL,
  verified_at TIMESTAMPTZ NULL,
  -- Real commit is never a stub when commit_stub = false.
  commit_stub BOOLEAN NOT NULL DEFAULT false,
  commit_detail TEXT NULL,
  commit_sha TEXT NULL,
  branch_name TEXT NULL,
  pr_url TEXT NULL,
  pr_number INT NULL,
  preview_url TEXT NULL,
  verify_ok BOOLEAN NULL,
  verify_detail TEXT NULL,
  error_detail TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_fix_flows_user
  ON fix_strategies_fix_flows(user_id);
CREATE INDEX IF NOT EXISTS idx_fs_fix_flows_step
  ON fix_strategies_fix_flows(step);

ALTER TABLE fix_strategies_fix_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own fix flows" ON fix_strategies_fix_flows;
CREATE POLICY "Users read own fix flows"
  ON fix_strategies_fix_flows FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON fix_strategies_fix_flows FROM anon, authenticated;
GRANT SELECT ON fix_strategies_fix_flows TO authenticated;

COMMENT ON TABLE fix_strategies_fix_flows IS
  'Findings fix-flow session: approve → GitHub PR commit → live verify after deploy.';
