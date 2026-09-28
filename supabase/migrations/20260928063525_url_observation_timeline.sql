-- Change Monitoring 3.1 — per-URL observation timeline across crawl runs.
-- One row per (run_id, url). Classification (transient/persistent/…) is
-- computed in code from the ordered series — never from a single observation.

CREATE TABLE IF NOT EXISTS fix_strategies_url_observations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE CASCADE,
  site_id UUID NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  detect_origin TEXT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  final_url TEXT NULL,
  http_status INT NULL,
  redirect_hops TEXT[] NOT NULL DEFAULT '{}',
  retry_after TEXT NULL,
  duration_ms INT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, url)
);

CREATE INDEX IF NOT EXISTS idx_fs_url_obs_site_url_observed
  ON fix_strategies_url_observations(site_id, url, observed_at DESC)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fs_url_obs_detect_url_observed
  ON fix_strategies_url_observations(detect_origin, user_id, url, observed_at DESC)
  WHERE site_id IS NULL;

ALTER TABLE fix_strategies_url_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own url observations" ON fix_strategies_url_observations;
CREATE POLICY "Users select own url observations"
  ON fix_strategies_url_observations FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE fix_strategies_url_observations IS
  'Change Monitoring 3.1: per-URL fetch observations across crawl runs.';
