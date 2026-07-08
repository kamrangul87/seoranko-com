-- Phase 1: AEO/GEO enrichment columns
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS rank_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fact_density_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fact_density_grade TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS answer_first BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS faq_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_schema BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS faqs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS schema_json JSONB DEFAULT NULL;

-- Index for filtering by rank score (for Ranking Agent later)
CREATE INDEX IF NOT EXISTS idx_articles_rank_score ON articles(rank_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_user_rank ON articles(user_id, rank_score DESC);

COMMENT ON COLUMN articles.rank_score IS 'Composite RANK score: SEO(40%) + AEO(35%) + GEO(25%). 0-100.';
COMMENT ON COLUMN articles.fact_density_grade IS 'A/B/C/D/F grade for fact density (AEO signal)';
COMMENT ON COLUMN articles.answer_first IS 'Whether direct answer appears in first 30% of article (AEO signal)';
