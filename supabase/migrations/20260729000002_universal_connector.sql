-- Universal multi-CMS connector: Universal Tag token + fix queue, plus a
-- generic per-platform credential store.
--
-- SECURITY: `credentials` holds live platform secrets (Shopify Admin tokens,
-- Webflow API tokens, WP application passwords). It gets the same column-level
-- REVOKE as wp_app_password — without this, adding the generic column would
-- silently undo the credential protection added in 20260729000001.

ALTER TABLE connected_sites
  ADD COLUMN IF NOT EXISTS universal_tag_token TEXT UNIQUE DEFAULT gen_random_uuid()::text;

UPDATE connected_sites
  SET universal_tag_token = gen_random_uuid()::text
  WHERE universal_tag_token IS NULL;

CREATE TABLE IF NOT EXISTS universal_tag_fixes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID REFERENCES connected_sites(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  fix_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_universal_fixes_lookup
  ON universal_tag_fixes(site_id, target_url) WHERE is_active = TRUE;

ALTER TABLE universal_tag_fixes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own universal tag fixes" ON universal_tag_fixes;
CREATE POLICY "Users see own universal tag fixes"
ON universal_tag_fixes FOR SELECT
USING (EXISTS (
  SELECT 1 FROM connected_sites cs
  WHERE cs.id = universal_tag_fixes.site_id AND cs.user_id = auth.uid()
));

ALTER TABLE site_connections
  ADD COLUMN IF NOT EXISTS credentials JSONB DEFAULT '{}'::jsonb;

UPDATE site_connections
  SET credentials = jsonb_build_object('username', wp_username, 'appPassword', wp_app_password)
  WHERE (credentials IS NULL OR credentials = '{}'::jsonb)
    AND wp_username IS NOT NULL;

REVOKE ALL ON site_connections FROM anon, authenticated;
GRANT SELECT (id, site_id, user_id, cms_type, wp_username, detected_seo_plugin,
              last_verified_at, is_active, created_at)
  ON site_connections TO authenticated;

COMMENT ON COLUMN site_connections.credentials IS
  'Platform-specific secrets (Shopify accessToken, Webflow apiToken, WP appPassword). Column privilege revoked from browser roles — service role only.';
