-- Rankings Track: link tracked URLs to articles + persist per-row diagnosis
ALTER TABLE ranking_agent_articles
  ADD COLUMN IF NOT EXISTS article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_diagnosis JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_diagnosed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_ranking_agent_article_id
  ON ranking_agent_articles(article_id)
  WHERE article_id IS NOT NULL;

COMMENT ON COLUMN ranking_agent_articles.article_id IS
  'Optional link to a SEORANKO articles row when the tracked URL matches article_url';
COMMENT ON COLUMN ranking_agent_articles.last_diagnosis IS
  'Latest RANKO diagnosis JSON for this tracked article (Diagnose tab)';
