-- Phase 4: Topical Authority + Advanced Ranking Intelligence

-- Topical maps table
CREATE TABLE IF NOT EXISTS topical_maps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  map_data JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cluster_count INTEGER DEFAULT 0,
  total_articles INTEGER DEFAULT 0,
  orphan_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topical_maps_user ON topical_maps(user_id);

-- Cannibalisation results table
CREATE TABLE IF NOT EXISTS cannibalization_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  pairs JSONB NOT NULL DEFAULT '[]',
  total_conflicts INTEGER DEFAULT 0,
  high_severity INTEGER DEFAULT 0,
  top_action TEXT DEFAULT NULL,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cannibalization_user ON cannibalization_results(user_id, checked_at DESC);

-- SERP intent analysis cache
CREATE TABLE IF NOT EXISTS serp_intent_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  location_code INTEGER DEFAULT 2840,
  intent TEXT NOT NULL,
  confidence INTEGER DEFAULT 0,
  serp_evidence TEXT DEFAULT NULL,
  can_rank BOOLEAN DEFAULT TRUE,
  ceiling INTEGER DEFAULT NULL,
  recommendation TEXT DEFAULT NULL,
  top_result_types TEXT[] DEFAULT '{}',
  serp_features TEXT[] DEFAULT '{}',
  analysed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(keyword, location_code)
);

-- Add entity score to articles table
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS entity_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_grade TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_entities TEXT[] DEFAULT '{}';

-- Add velocity prediction to ranking agent articles
ALTER TABLE ranking_agent_articles
  ADD COLUMN IF NOT EXISTS weekly_velocity NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS predicted_weeks_to_page1 INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS predicted_date_to_page1 TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS velocity_confidence TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_velocity_calc TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add competitor gap cache to articles
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS competitor_gap JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS competitor_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gap_checked_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Enable RLS on new tables
ALTER TABLE topical_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE cannibalization_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own topical maps" ON topical_maps
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users own cannibalization results" ON cannibalization_results
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE topical_maps IS 'Auto-generated topical authority cluster maps from user articles';
COMMENT ON TABLE cannibalization_results IS 'Keyword cannibalisation detection results with fix recommendations';
COMMENT ON TABLE serp_intent_cache IS 'SERP intent analysis cache — classified from live SERP results not ML models';
