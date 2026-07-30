-- §10 item 2: "Establish ground truth. 10–20 keywords on one real site, mixed
-- positions, manually checked in incognito at UK locale. Compare against what
-- the agent returns."
--
-- The manual check is human work; this is where the result is recorded so the
-- comparison in item 3 is evidence rather than recollection.
CREATE TABLE IF NOT EXISTS rank_ground_truth (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  keyword TEXT NOT NULL,
  target_url TEXT NOT NULL,
  location_code INT NOT NULL,
  device TEXT DEFAULT 'desktop',

  observed_position INT,
  observed_url TEXT,
  ads_above INT DEFAULT 0,
  notes TEXT,

  observed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, keyword, location_code, device, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_ground_truth_user ON rank_ground_truth(user_id, keyword);

ALTER TABLE rank_ground_truth ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ground truth" ON rank_ground_truth;
CREATE POLICY "Users manage own ground truth"
ON rank_ground_truth FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE rank_ground_truth IS
  '§10 item 2 — manually observed SERP positions, recorded so item 3 (data-in check) compares against evidence. observed_position counts ORGANIC results only.';
COMMENT ON COLUMN rank_ground_truth.ads_above IS
  'Number of ads/features above the result. If rank_absolute - rank_group equals this, the agent is reading the wrong field.';
