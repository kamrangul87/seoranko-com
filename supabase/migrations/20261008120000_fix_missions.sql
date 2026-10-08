-- Fix Mission overview: classify actionable findings into SAFE / REVIEW / BLOCKED.
-- Does not copy finding rows; items reference fix_strategies_findings.
-- No customer-repo writes on this path.

CREATE TABLE IF NOT EXISTS fix_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  crawl_run_id UUID NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'cancelled')),
  total_actionable INT NOT NULL DEFAULT 0,
  safe_count INT NOT NULL DEFAULT 0,
  review_count INT NOT NULL DEFAULT 0,
  blocked_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fix_missions_user ON fix_missions(user_id);
CREATE INDEX IF NOT EXISTS idx_fix_missions_site ON fix_missions(site_id);
CREATE INDEX IF NOT EXISTS idx_fix_missions_site_created
  ON fix_missions(site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fix_mission_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES fix_missions(id) ON DELETE CASCADE,
  finding_id UUID NOT NULL REFERENCES fix_strategies_findings(id) ON DELETE CASCADE,
  finding_code TEXT NOT NULL,
  strategy_id TEXT NULL,
  eligibility TEXT NOT NULL
    CHECK (eligibility IN ('safe', 'review', 'blocked')),
  block_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending')),
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mission_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_fix_mission_items_mission ON fix_mission_items(mission_id);
CREATE INDEX IF NOT EXISTS idx_fix_mission_items_eligibility
  ON fix_mission_items(mission_id, eligibility);

ALTER TABLE fix_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_mission_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own fix missions" ON fix_missions;
CREATE POLICY "Users read own fix missions"
  ON fix_missions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own fix missions" ON fix_missions;
CREATE POLICY "Users insert own fix missions"
  ON fix_missions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own fix missions" ON fix_missions;
CREATE POLICY "Users update own fix missions"
  ON fix_missions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own fix mission items" ON fix_mission_items;
CREATE POLICY "Users read own fix mission items"
  ON fix_mission_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM fix_missions m
      WHERE m.id = fix_mission_items.mission_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users insert own fix mission items" ON fix_mission_items;
CREATE POLICY "Users insert own fix mission items"
  ON fix_mission_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM fix_missions m
      WHERE m.id = fix_mission_items.mission_id
        AND m.user_id = auth.uid()
    )
  );

REVOKE ALL ON fix_missions FROM anon, authenticated;
REVOKE ALL ON fix_mission_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON fix_missions TO authenticated;
GRANT SELECT, INSERT ON fix_mission_items TO authenticated;

COMMENT ON TABLE fix_missions IS
  'Fix Mission overview: classified actionable findings (no fix execution).';
COMMENT ON TABLE fix_mission_items IS
  'Per-finding eligibility inside a fix_missions plan; references findings rows.';
