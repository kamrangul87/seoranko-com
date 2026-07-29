-- WordPress site connections + the auto-fix audit log.
--
-- SECURITY NOTE: wp_app_password is a live credential to the user's own
-- website. RLS alone is not enough here — a `FOR ALL USING (auth.uid() =
-- user_id)` policy would let the *browser* select the password with the anon
-- key. Instead the browser gets read-only row access with the credential
-- column REVOKEd at the column level, and all writes go through service-role
-- API routes. Postgres enforces the column privilege itself.

CREATE TABLE IF NOT EXISTS site_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  cms_type TEXT NOT NULL DEFAULT 'wordpress',
  wp_username TEXT NOT NULL,
  wp_app_password TEXT NOT NULL,
  detected_seo_plugin TEXT,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(site_id)
);

ALTER TABLE site_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own site connections" ON site_connections;
DROP POLICY IF EXISTS "Users read own site connections" ON site_connections;
CREATE POLICY "Users read own site connections"
ON site_connections FOR SELECT
USING (auth.uid() = user_id);

REVOKE ALL ON site_connections FROM anon, authenticated;
GRANT SELECT (id, site_id, user_id, cms_type, wp_username, detected_seo_plugin,
              last_verified_at, is_active, created_at)
  ON site_connections TO authenticated;

CREATE TABLE IF NOT EXISTS site_autofix_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES connected_sites(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL,
  fix_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified BOOLEAN DEFAULT FALSE,
  verification_result JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_site_autofix_log_user ON site_autofix_log(user_id);

ALTER TABLE site_autofix_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own autofix log" ON site_autofix_log;
CREATE POLICY "Users see own autofix log"
ON site_autofix_log FOR SELECT
USING (auth.uid() = user_id);

COMMENT ON TABLE site_connections IS
  'WordPress Application Password credentials for real site auto-fix. wp_app_password is REVOKEd from anon/authenticated at column level — only the service role can read it.';
COMMENT ON COLUMN site_connections.wp_app_password IS
  'Live WordPress credential. Never select this from client code; column privilege is revoked from browser roles.';
COMMENT ON TABLE site_autofix_log IS
  'RANKO Data Flywheel — every site-level fix applied, with post-fix verification result.';
