-- Fix Agent: encrypted credentials at rest + per-attempt audit trail with revert.
--
-- credentials_ciphertext stores AES-256-GCM blobs (enc:v1:…) produced by
-- src/lib/site-connection-crypto.ts. The plaintext credentials JSONB column is
-- cleared on write going forward; legacy rows may still have plaintext until
-- the connection is re-verified.
--
-- fix_agent_attempts logs every auto-fix try (success or fail) with
-- before/after snapshots so the user can review and one-click revert.

ALTER TABLE site_connections
  ADD COLUMN IF NOT EXISTS credentials_ciphertext TEXT;

COMMENT ON COLUMN site_connections.credentials_ciphertext IS
  'AES-256-GCM encrypted credential blob (enc:v1:…). Service-role only — never grant to anon/authenticated.';

-- Browser roles already cannot SELECT credentials / wp_app_password; keep
-- ciphertext equally inaccessible from the client.
REVOKE ALL ON site_connections FROM anon, authenticated;
GRANT SELECT (id, site_id, user_id, cms_type, wp_username, detected_seo_plugin,
              last_verified_at, is_active, created_at)
  ON site_connections TO authenticated;

CREATE TABLE IF NOT EXISTS fix_agent_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES site_connections(id) ON DELETE SET NULL,
  target_url TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  issue_title TEXT,
  auto_kind TEXT NOT NULL,
  strategy TEXT NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | applied | verified | failed | skipped | reverted | handed_off
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

CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_user ON fix_agent_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_site ON fix_agent_attempts(site_id);
CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_url ON fix_agent_attempts(target_url);
CREATE INDEX IF NOT EXISTS idx_fix_agent_attempts_created ON fix_agent_attempts(created_at DESC);

ALTER TABLE fix_agent_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own fix agent attempts" ON fix_agent_attempts;
CREATE POLICY "Users read own fix agent attempts"
ON fix_agent_attempts FOR SELECT
USING (auth.uid() = user_id);

REVOKE ALL ON fix_agent_attempts FROM anon, authenticated;
GRANT SELECT ON fix_agent_attempts TO authenticated;

COMMENT ON TABLE fix_agent_attempts IS
  'Fix Agent audit trail — every auto-fix attempt with before/after for review and revert. Writes are service-role only.';
