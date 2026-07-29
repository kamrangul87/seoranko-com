-- Connected Sites — the "Project" pattern (Ahrefs/Semrush style).
-- The user connects their real domain(s) once; RANKO Diagnose, Audit,
-- Cannibalisation and Topical Map all operate against one of these rather
-- than a hardcoded https://yoursite.com placeholder.

CREATE TABLE IF NOT EXISTS connected_sites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  brand TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_connected_sites_user ON connected_sites(user_id);

ALTER TABLE connected_sites ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS; drop first so this migration is re-runnable.
DROP POLICY IF EXISTS "Users manage own sites" ON connected_sites;
CREATE POLICY "Users manage own sites"
ON connected_sites FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE connected_sites IS
  'User-connected real domains. Every diagnostic tool (RANKO Diagnose, Audit, Cannibalisation) operates against one of these — never a placeholder.';
