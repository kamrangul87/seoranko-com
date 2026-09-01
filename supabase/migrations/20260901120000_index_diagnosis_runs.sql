-- Index Diagnosis audit runs (crawl coverage + per-URL indexability + cohorts).
-- Written by service role from /api/copilot/audit; users read own rows via RLS.

CREATE TABLE IF NOT EXISTS index_diagnosis_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  seed_url TEXT NOT NULL,
  verdict_headline TEXT NOT NULL,
  coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  cohorts JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_causes JSONB NOT NULL DEFAULT '[]'::jsonb,
  indexable_count INT NOT NULL DEFAULT 0,
  blocked_count INT NOT NULL DEFAULT 0,
  at_risk_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_index_diagnosis_runs_user ON index_diagnosis_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_index_diagnosis_runs_domain ON index_diagnosis_runs(domain);
CREATE INDEX IF NOT EXISTS idx_index_diagnosis_runs_created ON index_diagnosis_runs(created_at DESC);

ALTER TABLE index_diagnosis_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own index diagnosis runs" ON index_diagnosis_runs;
CREATE POLICY "Users read own index diagnosis runs"
ON index_diagnosis_runs FOR SELECT
USING (auth.uid() = user_id);

REVOKE ALL ON index_diagnosis_runs FROM anon, authenticated;
GRANT SELECT ON index_diagnosis_runs TO authenticated;

COMMENT ON TABLE index_diagnosis_runs IS
  'Index Diagnosis crawl runs — coverage, indexability chain, cohort comparison. Inserts are service-role only.';
