-- Phase 2: GEO Toolkit

-- GEO Audit results table
CREATE TABLE IF NOT EXISTS geo_audits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  composite_score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  signals JSONB NOT NULL DEFAULT '[]',
  top_fixes TEXT[] DEFAULT '{}',
  audited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geo_audits_user ON geo_audits(user_id, audited_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_audits_url ON geo_audits(url);

COMMENT ON TABLE geo_audits IS 'GEO Site Audit results — 8-signal AI readiness scores per URL';

-- Ranking Agent citation tracking
ALTER TABLE ranking_agent_articles
  ADD COLUMN IF NOT EXISTS citation_share_of_voice INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS citation_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS refresh_history JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ranking_agent_articles.citation_share_of_voice IS '0–100: % of AI queries where domain appears in citations';
COMMENT ON COLUMN ranking_agent_articles.citation_history IS 'Weekly citation check results array';
COMMENT ON COLUMN ranking_agent_articles.last_refresh_at IS 'Last time content freshness refresh was applied';
COMMENT ON COLUMN ranking_agent_articles.refresh_history IS 'Log of auto-refresh passes: [{date, changes}]';

-- Profiles: weekly digest opt-in
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN profiles.digest_enabled IS 'Whether user receives weekly SEORANKO digest email';

CREATE INDEX IF NOT EXISTS idx_profiles_digest ON profiles(digest_enabled) WHERE digest_enabled = TRUE;
