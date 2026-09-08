-- Intervention Dataset PR2: pre-registration, intervention events, causal results,
-- GSC revision checks, and taxonomy lookup. Idempotent — hosted may already have
-- these tables from an earlier MCP apply that was not committed to git.

-- ── Taxonomy lookup (Phase C) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intervention_taxonomy (
  intervention_type TEXT NOT NULL,
  intervention_subtype TEXT NOT NULL,
  interference_scope TEXT NOT NULL
    CHECK (interference_scope IN ('url', 'section', 'sitewide')),
  PRIMARY KEY (intervention_type, intervention_subtype)
);

ALTER TABLE intervention_taxonomy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read intervention taxonomy" ON intervention_taxonomy;
CREATE POLICY "Authenticated read intervention taxonomy"
  ON intervention_taxonomy FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON intervention_taxonomy FROM anon, authenticated;
GRANT SELECT ON intervention_taxonomy TO authenticated;

INSERT INTO intervention_taxonomy (intervention_type, intervention_subtype, interference_scope) VALUES
  ('metadata', 'title', 'url'),
  ('metadata', 'meta_description', 'url'),
  ('indexability', 'canonical', 'url'),
  ('indexability', 'meta_robots', 'url'),
  ('indexability', 'robots_txt', 'sitewide'),
  ('structured_data', 'schema_added', 'url'),
  ('structured_data', 'schema_modified', 'url'),
  ('structured_data', 'schema_removed', 'url'),
  ('internal_linking', 'inlink_added', 'section'),
  ('internal_linking', 'inlink_removed', 'section'),
  ('internal_linking', 'anchor_changed', 'section'),
  ('heading_structure', 'h1_changed', 'url'),
  ('heading_structure', 'hierarchy_fixed', 'url')
ON CONFLICT (intervention_type, intervention_subtype) DO UPDATE
  SET interference_scope = EXCLUDED.interference_scope;

-- ── experiment_preregistrations (Phase B1) ────────────────────────────────
-- Hosted may already have a stub from an earlier MCP apply without site_id /
-- other columns. CREATE TABLE IF NOT EXISTS is a no-op in that case — align
-- columns before creating indexes (Vercel prod failed on idx_*_site).
CREATE TABLE IF NOT EXISTS experiment_preregistrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  primary_metric TEXT NOT NULL
    CHECK (primary_metric IN ('impressions', 'clicks', 'ctr', 'average_position')),
  expected_direction TEXT NOT NULL
    CHECK (expected_direction IN ('increase', 'decrease', 'no_prediction')),
  baseline_window_days INTEGER NOT NULL CHECK (baseline_window_days > 0),
  observation_window_days INTEGER NOT NULL CHECK (observation_window_days > 0),
  analysis_method TEXT NOT NULL DEFAULT 'difference_in_differences'
    CHECK (analysis_method IN ('difference_in_differences')),
  minimum_detectable_effect DOUBLE PRECISION,
  preregistration_hash TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE experiment_preregistrations
  ADD COLUMN IF NOT EXISTS experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES connected_sites(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS primary_metric TEXT,
  ADD COLUMN IF NOT EXISTS expected_direction TEXT,
  ADD COLUMN IF NOT EXISTS baseline_window_days INTEGER,
  ADD COLUMN IF NOT EXISTS observation_window_days INTEGER,
  ADD COLUMN IF NOT EXISTS analysis_method TEXT DEFAULT 'difference_in_differences',
  ADD COLUMN IF NOT EXISTS minimum_detectable_effect DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS preregistration_hash TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_experiment_prereg_site ON experiment_preregistrations(site_id);
CREATE INDEX IF NOT EXISTS idx_experiment_prereg_user ON experiment_preregistrations(user_id);

ALTER TABLE experiment_preregistrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own experiment preregistrations" ON experiment_preregistrations;
CREATE POLICY "Users read own experiment preregistrations"
  ON experiment_preregistrations FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON experiment_preregistrations FROM anon, authenticated;
GRANT SELECT ON experiment_preregistrations TO authenticated;

CREATE OR REPLACE FUNCTION prevent_preregistration_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'experiment_preregistrations rows are immutable after lock';
  END IF;
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'experiment_preregistrations rows are immutable after lock';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preregistration_immutable ON experiment_preregistrations;
CREATE TRIGGER trg_preregistration_immutable
  BEFORE UPDATE OR DELETE ON experiment_preregistrations
  FOR EACH ROW
  EXECUTE FUNCTION prevent_preregistration_mutation();

-- ── intervention_events (Phase B2) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intervention_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experiment_id UUID REFERENCES experiments(id) ON DELETE SET NULL,
  -- Normalized page URL (no separate urls table yet). Named url_id per spec.
  url_id TEXT NOT NULL,
  intervention_type TEXT NOT NULL,
  intervention_subtype TEXT NOT NULL,
  interference_scope TEXT NOT NULL
    CHECK (interference_scope IN ('url', 'section', 'sitewide')),
  is_isolated BOOLEAN NOT NULL DEFAULT TRUE,
  component_types TEXT[] NOT NULL DEFAULT '{}',
  lifecycle_state TEXT NOT NULL DEFAULT 'recommended'
    CHECK (lifecycle_state IN (
      'recommended', 'implemented', 'verified', 'measuring', 'completed',
      'insufficient_data', 'invalid', 'interrupted', 'implementation_failed'
    )),
  actor TEXT NOT NULL
    CHECK (actor IN ('fix_agent', 'user_confirmed', 'deploy_detected')),
  applied_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  before_state_hash TEXT,
  after_state_hash TEXT,
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT intervention_events_taxonomy_fk
    FOREIGN KEY (intervention_type, intervention_subtype)
    REFERENCES intervention_taxonomy (intervention_type, intervention_subtype),
  CONSTRAINT intervention_events_unique_apply
    UNIQUE (url_id, intervention_type, applied_at)
);

ALTER TABLE intervention_events
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES connected_sites(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS experiment_id UUID REFERENCES experiments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS url_id TEXT,
  ADD COLUMN IF NOT EXISTS intervention_type TEXT,
  ADD COLUMN IF NOT EXISTS intervention_subtype TEXT,
  ADD COLUMN IF NOT EXISTS interference_scope TEXT,
  ADD COLUMN IF NOT EXISTS is_isolated BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS component_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT DEFAULT 'recommended',
  ADD COLUMN IF NOT EXISTS actor TEXT,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS before_state_hash TEXT,
  ADD COLUMN IF NOT EXISTS after_state_hash TEXT,
  ADD COLUMN IF NOT EXISTS before_state JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_state JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS change_diff JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_intervention_events_site ON intervention_events(site_id);
CREATE INDEX IF NOT EXISTS idx_intervention_events_experiment ON intervention_events(experiment_id);
CREATE INDEX IF NOT EXISTS idx_intervention_events_lifecycle ON intervention_events(lifecycle_state);

ALTER TABLE intervention_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own intervention events" ON intervention_events;
CREATE POLICY "Users read own intervention events"
  ON intervention_events FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON intervention_events FROM anon, authenticated;
GRANT SELECT ON intervention_events TO authenticated;

CREATE OR REPLACE FUNCTION prevent_verified_intervention_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lifecycle_state = 'verified'
     OR OLD.lifecycle_state = 'measuring'
     OR OLD.lifecycle_state = 'completed' THEN
    IF NEW.before_state_hash IS DISTINCT FROM OLD.before_state_hash
       OR NEW.after_state_hash IS DISTINCT FROM OLD.after_state_hash
       OR NEW.applied_at IS DISTINCT FROM OLD.applied_at THEN
      RAISE EXCEPTION 'verified intervention hashes and applied_at are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verified_intervention_immutable ON intervention_events;
CREATE TRIGGER trg_verified_intervention_immutable
  BEFORE UPDATE ON intervention_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_verified_intervention_mutation();

-- ── gsc_revision_checks (Phase B3) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gsc_revision_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  revision_detected BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gsc_revision_checks
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES connected_sites(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS window_start DATE,
  ADD COLUMN IF NOT EXISTS window_end DATE,
  ADD COLUMN IF NOT EXISTS revision_detected BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_gsc_revision_checks_site ON gsc_revision_checks(site_id, checked_at DESC);

ALTER TABLE gsc_revision_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own gsc revision checks" ON gsc_revision_checks;
CREATE POLICY "Users read own gsc revision checks"
  ON gsc_revision_checks FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON gsc_revision_checks FROM anon, authenticated;
GRANT SELECT ON gsc_revision_checks TO authenticated;

-- ── causal_results (Phase B4) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS causal_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  intervention_id UUID NOT NULL REFERENCES intervention_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  metric TEXT NOT NULL
    CHECK (metric IN ('impressions', 'clicks', 'ctr', 'average_position')),
  is_exploratory BOOLEAN NOT NULL DEFAULT FALSE,
  effect_estimate DOUBLE PRECISION,
  confidence_interval_low DOUBLE PRECISION,
  confidence_interval_high DOUBLE PRECISION,
  treatment_n INTEGER,
  control_n INTEGER,
  baseline_period_start DATE,
  baseline_period_end DATE,
  observation_period_start DATE,
  observation_period_end DATE,
  method TEXT NOT NULL DEFAULT 'difference_in_differences',
  validity_status TEXT NOT NULL
    CHECK (validity_status IN (
      'valid',
      'insufficient_data',
      'invalid_baseline',
      'interrupted',
      'volatility_suspected',
      'missing_gsc_data',
      'implementation_unverified',
      'interference_suspected'
    )),
  result_direction TEXT
    CHECK (result_direction IS NULL OR result_direction IN ('positive', 'negative', 'neutral')),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotent re-runs: one primary (non-exploratory) result per intervention+metric
  UNIQUE (intervention_id, metric, is_exploratory)
);

ALTER TABLE causal_results
  ADD COLUMN IF NOT EXISTS experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS intervention_id UUID REFERENCES intervention_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES connected_sites(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS metric TEXT,
  ADD COLUMN IF NOT EXISTS is_exploratory BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS effect_estimate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS confidence_interval_low DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS confidence_interval_high DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS treatment_n INTEGER,
  ADD COLUMN IF NOT EXISTS control_n INTEGER,
  ADD COLUMN IF NOT EXISTS baseline_period_start DATE,
  ADD COLUMN IF NOT EXISTS baseline_period_end DATE,
  ADD COLUMN IF NOT EXISTS observation_period_start DATE,
  ADD COLUMN IF NOT EXISTS observation_period_end DATE,
  ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'difference_in_differences',
  ADD COLUMN IF NOT EXISTS validity_status TEXT,
  ADD COLUMN IF NOT EXISTS result_direction TEXT,
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_causal_results_experiment ON causal_results(experiment_id);
CREATE INDEX IF NOT EXISTS idx_causal_results_site ON causal_results(site_id);

ALTER TABLE causal_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own causal results" ON causal_results;
CREATE POLICY "Users read own causal results"
  ON causal_results FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON causal_results FROM anon, authenticated;
GRANT SELECT ON causal_results TO authenticated;

COMMENT ON TABLE experiment_preregistrations IS
  'Locked analysis plan before intervention. Immutable after locked_at (DB trigger).';
COMMENT ON TABLE intervention_events IS
  'Recorded website interventions with normalised before/after state (never full HTML).';
COMMENT ON TABLE causal_results IS
  'Measured outcomes under a pre-registered analysis. Exploratory metrics flagged separately.';
COMMENT ON TABLE gsc_revision_checks IS
  'Detects Google retroactively revising settled GSC baseline windows.';
