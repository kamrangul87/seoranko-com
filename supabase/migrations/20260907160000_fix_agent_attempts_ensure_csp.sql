-- Ensure Fix Agent attempt trail exists on hosted DBs that missed
-- 20260827120000 (table was in-repo but never applied — Failed attempts UI
-- was only showing the in-memory POST response for the current page load).

CREATE TABLE IF NOT EXISTS fix_agent_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES site_connections(id) ON DELETE SET NULL,
  target_url TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  issue_key TEXT,
  issue_title TEXT,
  auto_kind TEXT NOT NULL,
  strategy TEXT NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | applied | verified | failed | skipped | reverted | handed_off | pending_deploy | pending_merge | unverified | pr_pending
  -- Only `verified` means live re-crawl confirmed the change. `unverified` / `pr_pending` are not done.
  before_snapshot TEXT,
  after_snapshot TEXT,
  diff_summary TEXT,
  verification_detail TEXT,
  error_message TEXT,
  score_before INT,
  score_after INT,
  human_task JSONB,
  revertible BOOLEAN DEFAULT FALSE,
  reverted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE fix_agent_attempts
  ADD COLUMN IF NOT EXISTS issue_key TEXT;

CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_user ON fix_agent_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_site ON fix_agent_attempts(site_id);
CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_url ON fix_agent_attempts(target_url);
CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_created ON fix_agent_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_kind_status
  ON fix_agent_attempts(site_id, auto_kind, status);

ALTER TABLE fix_agent_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own fix agent attempts" ON fix_agent_attempts;
CREATE POLICY "Users read own fix agent attempts"
ON fix_agent_attempts FOR SELECT
USING (auth.uid() = user_id);

REVOKE ALL ON fix_agent_attempts FROM anon, authenticated;
GRANT SELECT ON fix_agent_attempts TO authenticated;

COMMENT ON TABLE fix_agent_attempts IS
  'Durable Fix Agent audit trail for PR2 treatment registry. Writes are service-role only.';
COMMENT ON COLUMN fix_agent_attempts.issue_key IS
  'Stable issue key (e.g. no_csp, no_breadcrumb_schema) when available — preferred over unstable audit-* ids.';

-- Approved / pending CSP policies per site (report-only first; enforce later).
CREATE TABLE IF NOT EXISTS site_csp_policies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'report_only', 'enforced', 'rejected')),
  policy_header TEXT NOT NULL,
  -- Content-Security-Policy-Report-Only or Content-Security-Policy value (no header name)
  origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_harvest_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id)
);

CREATE INDEX IF NOT EXISTS idx_site_csp_policies_user ON site_csp_policies(user_id);

ALTER TABLE site_csp_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own csp policies" ON site_csp_policies;
CREATE POLICY "Users read own csp policies"
  ON site_csp_policies FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON site_csp_policies FROM anon, authenticated;
GRANT SELECT (
  id, user_id, site_id, status, policy_header, origins, observed_origins,
  last_harvest_at, approved_at, created_at, updated_at
) ON site_csp_policies TO authenticated;

COMMENT ON TABLE site_csp_policies IS
  'CSP Builder state. First ship is report-only after human approval; enforce only after a clean observation window.';
