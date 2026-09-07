-- Account-level Google Search Console OAuth (multi-property onboarding).
-- Property→site mappings remain on gsc_connections (one row per connected_sites).

CREATE TABLE IF NOT EXISTS gsc_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_gsc_accounts_status ON gsc_accounts(status);

ALTER TABLE gsc_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own gsc accounts" ON gsc_accounts;
CREATE POLICY "Users read own gsc accounts"
  ON gsc_accounts FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON gsc_accounts FROM anon, authenticated;
GRANT SELECT (
  id, user_id, status, connected_at, last_error
) ON gsc_accounts TO authenticated;

COMMENT ON TABLE gsc_accounts IS
  'User-level Google OAuth for Search Console. Used to list properties and seed per-site gsc_connections. refresh_token_encrypted is service-role only.';
COMMENT ON COLUMN gsc_accounts.refresh_token_encrypted IS
  'AES-256-GCM blob (enc:v1:…). Never grant to anon/authenticated.';
