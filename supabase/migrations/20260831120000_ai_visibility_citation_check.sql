-- AI Visibility / Citation Check (Phase 1 — OpenAI + Perplexity Sonar)
-- Stores tracked prompts, check runs (with cost), and per-engine results + diagnostics.

CREATE TABLE IF NOT EXISTS ai_visibility_prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | suggested | auto
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(site_id, prompt)
);

CREATE INDEX IF NOT EXISTS idx_ai_vis_prompts_site ON ai_visibility_prompts(site_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS ai_visibility_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | failed | partial
  prompt_count INT DEFAULT 0,
  citation_rate NUMERIC(5,2),
  mention_rate NUMERIC(5,2),
  cost_usd NUMERIC(10,6) DEFAULT 0,
  cost_breakdown JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  trigger TEXT DEFAULT 'manual' -- manual | first_connect | weekly_cron
);

CREATE INDEX IF NOT EXISTS idx_ai_vis_runs_site ON ai_visibility_runs(site_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_visibility_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES ai_visibility_runs(id) ON DELETE CASCADE,
  prompt_id UUID REFERENCES ai_visibility_prompts(id) ON DELETE SET NULL,
  prompt_text TEXT NOT NULL,
  engine TEXT NOT NULL, -- openai | perplexity
  mentioned BOOLEAN DEFAULT FALSE,
  cited BOOLEAN DEFAULT FALSE,
  cited_urls JSONB DEFAULT '[]'::jsonb,
  competitor_domains JSONB DEFAULT '[]'::jsonb,
  response_snippet TEXT,
  diagnostic JSONB,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_vis_results_run ON ai_visibility_results(run_id);

ALTER TABLE ai_visibility_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own ai visibility prompts" ON ai_visibility_prompts;
CREATE POLICY "Users manage own ai visibility prompts"
ON ai_visibility_prompts FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own ai visibility runs" ON ai_visibility_runs;
CREATE POLICY "Users read own ai visibility runs"
ON ai_visibility_runs FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own ai visibility results" ON ai_visibility_results;
CREATE POLICY "Users read own ai visibility results"
ON ai_visibility_results FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM ai_visibility_runs r
    WHERE r.id = ai_visibility_results.run_id AND r.user_id = auth.uid()
  )
);

COMMENT ON TABLE ai_visibility_runs IS
  'AI Visibility citation check runs — OpenAI + Perplexity only in Phase 1. cost_usd is logged for unit economics.';
