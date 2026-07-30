-- §10 item 9 / §7.8 — the four launch-minimum requirements:
--   1. treatment_id stamped on every Ranking Agent action
--   2. applied_at and indexed_at timestamps
--   3. 28-day washout enforced — one live treatment per unit, no exceptions
--   4. Daily observations stored per unit, never overwritten
-- (4) already exists via rank_history/rank_checks (§5 Source 1). This adds
-- (1)-(3). Scope is deliberately the §7.8 minimum, NOT the full §7.7 engine
-- (units/assignments/observations/effects) — §7.8 itself says everything else
-- in §7 is recoverable later; only these four are not.

CREATE TABLE IF NOT EXISTS treatments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  reversible BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO treatments (id, name, mechanism, reversible) VALUES
  ('T01', 'Add structured FAQ block',              'Question coverage',        TRUE),
  ('T02', 'Answer-first rewrite of opening',        'Answer proximity',         TRUE),
  ('T03', 'Fill entity coverage gap',                'Topical completeness',     TRUE),
  ('T04', 'Inject schema',                           'Machine readability',      TRUE),
  ('T05', 'Freshness refresh, no substantive change','Date signal alone (placebo)', TRUE),
  ('T06', 'Add N internal links pointing in',        'Internal authority',       TRUE),
  ('T07', 'Restructure headings to SERP questions',  'Query-section matching',   TRUE),
  ('T08', 'Rewrite title for intent match',          'Relevance and CTR',        TRUE),
  ('T09', 'Expand length to competitor median',      'Depth',                    TRUE),
  ('T10', 'Fill competitor subtopic gap',            'Coverage breadth',         TRUE)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE treatments IS
  '§7.1 canonical treatment catalog. Reference table — the current Ranking Agent does not yet operate in T01-T10 terms (it uses a coarser eeat/readability/human_score/fact_sourcing/all vocabulary); see page_treatments.legacy_target. Full alignment is Station 8 redesign (item 12), not this item.';

CREATE TABLE IF NOT EXISTS page_treatments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES ranking_agent_articles(id) ON DELETE CASCADE,

  treatment_id TEXT REFERENCES treatments(id),
  legacy_target TEXT,

  keyword TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  indexed_at TIMESTAMP WITH TIME ZONE,
  trigger_reason TEXT,
  changes_summary TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_treatments_unit ON page_treatments(unit_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_treatments_user ON page_treatments(user_id);

ALTER TABLE page_treatments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own page treatments" ON page_treatments;
CREATE POLICY "Users read own page treatments"
ON page_treatments FOR SELECT
USING (auth.uid() = user_id);

COMMENT ON TABLE page_treatments IS
  '§10 item 9 / §7.8 — every content-level Ranking Agent action, for the 28-day washout check and future effect analysis (§7.4+, deferred).';

ALTER TABLE site_autofix_log
  ADD COLUMN IF NOT EXISTS treatment_id TEXT REFERENCES treatments(id),
  ADD COLUMN IF NOT EXISTS legacy_target TEXT,
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN site_autofix_log.treatment_id IS
  '§10 item 9 — see treatments table comment on why this is usually NULL today.';
