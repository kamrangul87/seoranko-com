-- Phase 1e: AEO signals columns
ALTER TABLE articles ADD COLUMN IF NOT EXISTS heading_grade TEXT DEFAULT NULL;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS question_h2_count INTEGER DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS authority_link_count INTEGER DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS freshness_status TEXT DEFAULT 'fresh';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS llms_entry_added BOOLEAN DEFAULT FALSE;

ALTER TABLE ranking_agent_articles ADD COLUMN IF NOT EXISTS freshness_status TEXT DEFAULT 'fresh';
ALTER TABLE ranking_agent_articles ADD COLUMN IF NOT EXISTS needs_refresh BOOLEAN DEFAULT FALSE;
ALTER TABLE ranking_agent_articles ADD COLUMN IF NOT EXISTS refresh_reason TEXT DEFAULT NULL;
ALTER TABLE ranking_agent_articles ADD COLUMN IF NOT EXISTS last_citation_check TIMESTAMP DEFAULT NULL;
ALTER TABLE ranking_agent_articles ADD COLUMN IF NOT EXISTS perplexity_cited BOOLEAN DEFAULT NULL;
ALTER TABLE ranking_agent_articles ADD COLUMN IF NOT EXISTS chatgpt_cited BOOLEAN DEFAULT NULL;
ALTER TABLE ranking_agent_articles ADD COLUMN IF NOT EXISTS cited_competitors TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_articles_freshness ON articles(freshness_status);
CREATE INDEX IF NOT EXISTS idx_ranking_agent_needs_refresh ON ranking_agent_articles(needs_refresh) WHERE needs_refresh = TRUE;
