-- Phase 3: Ranking Agent live

-- Rank history table
CREATE TABLE IF NOT EXISTS rank_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ranking_article_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  position INTEGER DEFAULT NULL,
  previous_position INTEGER DEFAULT NULL,
  position_change INTEGER DEFAULT NULL,
  location_code INTEGER DEFAULT 2840,
  location_name TEXT DEFAULT 'Global',
  top_competitor TEXT DEFAULT NULL,
  serp_features TEXT[] DEFAULT '{}',
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rank_history_article
  ON rank_history(ranking_article_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_history_user
  ON rank_history(user_id, checked_at DESC);

-- Add columns to ranking_agent_articles
ALTER TABLE ranking_agent_articles
  ADD COLUMN IF NOT EXISTS article_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS current_position INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS previous_position INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS position_change INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS location_code INTEGER DEFAULT 2840,
  ADD COLUMN IF NOT EXISTS top_competitor TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_rank_check TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_reoptimise_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reoptimise_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS eeat_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS readability_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS human_score INTEGER DEFAULT NULL;

-- Add columns to articles
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS last_reoptimised_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reoptimise_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS eeat_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS readability_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS human_score INTEGER DEFAULT NULL;

COMMENT ON TABLE rank_history IS 'Weekly SERP rank checks per tracked article — global location support';
COMMENT ON COLUMN ranking_agent_articles.location_code IS
  'DataForSEO location: 2840=US/Global, 2826=UK, 2036=AU, 2356=IN, 2586=PK, 2784=UAE etc.';
COMMENT ON COLUMN ranking_agent_articles.position_change IS
  'Positive = improved (moved up), Negative = dropped (moved down)';
