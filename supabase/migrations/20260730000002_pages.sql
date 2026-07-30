-- §10 item 7: "Create pages table with stage. Nothing else changes."
--
-- Per §2: nothing runs without a Page record eventually — but per §9 rule 5
-- ("No rewrites. Wire existing code into the line.") this does NOT migrate or
-- replace `articles` yet. It is a parallel stage-tracking record, linked to the
-- existing content row via article_id where one exists. Full cutover (making
-- this THE object every feature reads) is item 11+, explicitly deferred.
--
-- stage is stored as smallint (0-8) matching §3's eight stations, with a
-- companion label for readability. winnability_score is numeric(5,4) because
-- §6.2 defines it as a probability W ∈ (0,1), not a 0-100 score.

CREATE TABLE IF NOT EXISTS pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,

  stage SMALLINT NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 8),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','blocked','done')),

  opportunity_id UUID,
  cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL,

  primary_keyword TEXT,
  secondary_keywords TEXT[] DEFAULT '{}',
  intent TEXT CHECK (intent IN ('informational','commercial','transactional','navigational')),

  winnability_score NUMERIC(5,4) CHECK (winnability_score IS NULL OR (winnability_score >= 0 AND winnability_score <= 1)),

  brief_json JSONB,
  content TEXT,

  rank_score INTEGER,
  aeo_score INTEGER,
  geo_score INTEGER,
  eeat_score INTEGER,
  entity_coverage INTEGER,

  schema_json JSONB,
  faqs JSONB,
  internal_links JSONB,

  url TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  current_rank INTEGER,
  last_action TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pages_user ON pages(user_id);
CREATE INDEX IF NOT EXISTS idx_pages_article ON pages(article_id);
CREATE INDEX IF NOT EXISTS idx_pages_stage ON pages(stage);
CREATE INDEX IF NOT EXISTS idx_pages_cluster ON pages(cluster_id);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own pages" ON pages;
CREATE POLICY "Users manage own pages"
ON pages FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE pages IS
  '§2/§10 item 7 — the Page object. Stage-tracking shadow record linked to articles via article_id; does not yet replace articles as the content store (§9 rule 5, no rewrites). Full cutover is item 11+.';
COMMENT ON COLUMN pages.stage IS
  '§3 station number 0-8: 0 Discover, 1 Keywords, 2 Plan, 3 Brief, 4 Write, 5 QA, 6 Publish, 7 Monitor, 8 Defend.';
COMMENT ON COLUMN pages.winnability_score IS
  '§6.2 — a probability W ∈ (0,1), not a 0-100 score. Betas start as declared priors, fitted once ~200 units resolve (item 18).';
