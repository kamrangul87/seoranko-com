-- Causal Experiment Engine PR1: GSC connection, daily URL metrics, experiment shell.
-- No treatments / DiD yet (PR2/PR3). Secrets stay service-role only.

-- ── gsc_connections ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gsc_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  property_url TEXT,
  refresh_token_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (site_id)
);

CREATE INDEX IF NOT EXISTS idx_gsc_connections_user ON gsc_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_gsc_connections_status ON gsc_connections(status);

ALTER TABLE gsc_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own gsc connections" ON gsc_connections;
CREATE POLICY "Users read own gsc connections"
  ON gsc_connections FOR SELECT
  USING (auth.uid() = user_id);

-- Browser must never read refresh tokens.
REVOKE ALL ON gsc_connections FROM anon, authenticated;
GRANT SELECT (
  id, user_id, site_id, property_url, status, connected_at, last_sync_at, last_error
) ON gsc_connections TO authenticated;

COMMENT ON TABLE gsc_connections IS
  'Google Search Console OAuth connections. refresh_token_encrypted is service-role only.';
COMMENT ON COLUMN gsc_connections.refresh_token_encrypted IS
  'AES-256-GCM blob (enc:v1:…). Never grant to anon/authenticated.';

-- ── url_metrics_daily ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS url_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  date DATE NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_position DOUBLE PRECISION NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, url, date)
);

CREATE INDEX IF NOT EXISTS idx_url_metrics_daily_site_date
  ON url_metrics_daily(site_id, date);
CREATE INDEX IF NOT EXISTS idx_url_metrics_daily_site_url
  ON url_metrics_daily(site_id, url);

ALTER TABLE url_metrics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own url metrics daily" ON url_metrics_daily;
CREATE POLICY "Users read own url metrics daily"
  ON url_metrics_daily FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM connected_sites cs
      WHERE cs.id = url_metrics_daily.site_id
        AND cs.user_id = auth.uid()
    )
  );

REVOKE ALL ON url_metrics_daily FROM anon, authenticated;
GRANT SELECT ON url_metrics_daily TO authenticated;

COMMENT ON COLUMN url_metrics_daily.is_final IS
  'False for GSC lag window (~last 3 days). Provisional rows are overwritten on later syncs.';

-- ── experiments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'baseline'
    CHECK (status IN ('baseline', 'ready', 'running', 'complete', 'abandoned')),
  baseline_start DATE,
  baseline_end DATE,
  min_urls_required INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiments_user ON experiments(user_id);
CREATE INDEX IF NOT EXISTS idx_experiments_site ON experiments(site_id);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own experiments" ON experiments;
CREATE POLICY "Users read own experiments"
  ON experiments FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON experiments FROM anon, authenticated;
GRANT SELECT ON experiments TO authenticated;

-- ── experiment_urls (cohort assignment is PR2 — table only) ─────────────────
CREATE TABLE IF NOT EXISTS experiment_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  cohort TEXT NOT NULL CHECK (cohort IN ('treated', 'holdout')),
  wave_number INTEGER,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (experiment_id, url)
);

CREATE INDEX IF NOT EXISTS idx_experiment_urls_experiment
  ON experiment_urls(experiment_id);

ALTER TABLE experiment_urls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own experiment urls" ON experiment_urls;
CREATE POLICY "Users read own experiment urls"
  ON experiment_urls FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM experiments e
      WHERE e.id = experiment_urls.experiment_id
        AND e.user_id = auth.uid()
    )
  );

REVOKE ALL ON experiment_urls FROM anon, authenticated;
GRANT SELECT ON experiment_urls TO authenticated;

-- ── baseline_readiness_checks (mechanical verdict + numeric evidence) ───────
CREATE TABLE IF NOT EXISTS baseline_readiness_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  passed BOOLEAN NOT NULL,
  reason_code TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_baseline_readiness_site_checked
  ON baseline_readiness_checks(site_id, checked_at DESC);

ALTER TABLE baseline_readiness_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own baseline readiness" ON baseline_readiness_checks;
CREATE POLICY "Users read own baseline readiness"
  ON baseline_readiness_checks FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON baseline_readiness_checks FROM anon, authenticated;
GRANT SELECT ON baseline_readiness_checks TO authenticated;

COMMENT ON TABLE baseline_readiness_checks IS
  'Mechanical baseline readiness verdicts with stored numeric evidence (Causal Engine PR1).';
