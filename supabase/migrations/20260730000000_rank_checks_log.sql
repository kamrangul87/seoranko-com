-- §10 item 1: instrument before touching logic.
-- One row per rank check, capturing exactly what was sent, what came back, how
-- the URL was matched, and whether the trigger fired. This is what items 2-4
-- (ground truth / data-in / matching) are read against.
CREATE TABLE IF NOT EXISTS rank_checks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID,

  keyword TEXT NOT NULL,
  location_code INT,
  language_code TEXT,
  device TEXT,
  os TEXT,
  depth INT,
  endpoint TEXT,

  raw_rank_group INT,
  raw_rank_absolute INT,
  matched_url TEXT,
  matched_domain TEXT,
  stored_url TEXT,
  stored_url_normalised TEXT,
  match_method TEXT,
  url_matched BOOLEAN,
  organic_count INT,
  serp_features TEXT[],
  api_error TEXT,

  trigger_fired BOOLEAN DEFAULT FALSE,
  trigger_reason TEXT,
  action_taken TEXT,

  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rank_checks_article ON rank_checks(article_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_checks_user ON rank_checks(user_id, checked_at DESC);

ALTER TABLE rank_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own rank checks" ON rank_checks;
CREATE POLICY "Users read own rank checks"
ON rank_checks FOR SELECT
USING (auth.uid() = user_id);

COMMENT ON TABLE rank_checks IS
  '§10 item 1 — per-check audit log for Ranking Agent reliability. Records request params, both DataForSEO rank fields, URL matching detail, and trigger decision. Read on day 8 per §10.';
COMMENT ON COLUMN rank_checks.raw_rank_group IS 'Organic position. Compare against incognito ground truth (item 2).';
COMMENT ON COLUMN rank_checks.raw_rank_absolute IS 'Position among all SERP items incl. ads/snippets. Inflated vs what a user calls "position N".';
