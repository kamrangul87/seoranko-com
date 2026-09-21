-- Fix-strategies crawl runs + persisted findings (Findings UI live path).
-- Owner via connected_sites.user_id. Service role writes; authenticated SELECT own rows.

CREATE TABLE IF NOT EXISTS fix_strategies_crawl_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'complete', 'failed', 'partial')),
  chunk_size INT NOT NULL DEFAULT 5,
  urls_discovered INT NOT NULL DEFAULT 0,
  urls_crawled INT NOT NULL DEFAULT 0,
  urls_failed INT NOT NULL DEFAULT 0,
  urls_client_only INT NOT NULL DEFAULT 0,
  urls_skipped_off_host INT NOT NULL DEFAULT 0,
  -- Partial coverage reasons (never present a partial crawl as complete).
  coverage_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_partial BOOLEAN NOT NULL DEFAULT false,
  error_detail TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_crawl_runs_site ON fix_strategies_crawl_runs(site_id);
CREATE INDEX IF NOT EXISTS idx_fs_crawl_runs_user ON fix_strategies_crawl_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_fs_crawl_runs_status ON fix_strategies_crawl_runs(status);

CREATE TABLE IF NOT EXISTS fix_strategies_crawl_url_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'crawled', 'failed', 'client_only', 'skipped')),
  http_status INT NULL,
  final_url TEXT NULL,
  stream_complete BOOLEAN NULL,
  client_only BOOLEAN NOT NULL DEFAULT false,
  crawler_caused_backoff BOOLEAN NOT NULL DEFAULT false,
  error_detail TEXT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, url)
);

CREATE INDEX IF NOT EXISTS idx_fs_crawl_jobs_run_status
  ON fix_strategies_crawl_url_jobs(run_id, status);

-- Stable finding identity: (site, topic, rollup_key). Re-crawls update
-- last_seen / observation rows rather than duplicating.
CREATE TABLE IF NOT EXISTS fix_strategies_findings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  bucket TEXT NOT NULL
    CHECK (bucket IN ('actionable', 'informational', 'internal')),
  verdict TEXT NOT NULL,
  severity TEXT NULL,
  rollup_key TEXT NOT NULL,
  declaration_site TEXT NULL,
  affected_url_count INT NOT NULL DEFAULT 1,
  page_url TEXT NULL,
  detail TEXT NOT NULL DEFAULT '',
  auto_fixable BOOLEAN NOT NULL DEFAULT false,
  report_only BOOLEAN NOT NULL DEFAULT true,
  surface_class TEXT NOT NULL DEFAULT 'finding',
  proposed_diff JSONB NULL,
  evidence_values JSONB NULL,
  source_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_run_id UUID NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE SET NULL,
  last_seen_run_id UUID NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, topic_id, rollup_key)
);

CREATE INDEX IF NOT EXISTS idx_fs_findings_site_bucket
  ON fix_strategies_findings(site_id, bucket);
CREATE INDEX IF NOT EXISTS idx_fs_findings_site_topic
  ON fix_strategies_findings(site_id, topic_id);

-- Which crawl runs observed a finding (start of fix→recrawl→outcome).
CREATE TABLE IF NOT EXISTS fix_strategies_finding_observations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  finding_id UUID NOT NULL REFERENCES fix_strategies_findings(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (finding_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_fs_finding_obs_run
  ON fix_strategies_finding_observations(run_id);

-- Internal-bucket evidence attached to a finding or run (never list API).
CREATE TABLE IF NOT EXISTS fix_strategies_finding_evidence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  finding_id UUID NULL REFERENCES fix_strategies_findings(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  page_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_finding_evidence_finding
  ON fix_strategies_finding_evidence(finding_id);
CREATE INDEX IF NOT EXISTS idx_fs_finding_evidence_run
  ON fix_strategies_finding_evidence(run_id);

ALTER TABLE fix_strategies_crawl_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_strategies_crawl_url_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_strategies_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_strategies_finding_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_strategies_finding_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own crawl runs" ON fix_strategies_crawl_runs;
CREATE POLICY "Users select own crawl runs"
  ON fix_strategies_crawl_runs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own crawl jobs" ON fix_strategies_crawl_url_jobs;
CREATE POLICY "Users select own crawl jobs"
  ON fix_strategies_crawl_url_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM fix_strategies_crawl_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users select own findings" ON fix_strategies_findings;
CREATE POLICY "Users select own findings"
  ON fix_strategies_findings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own finding observations" ON fix_strategies_finding_observations;
CREATE POLICY "Users select own finding observations"
  ON fix_strategies_finding_observations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM fix_strategies_findings f
      WHERE f.id = finding_id AND f.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users select own finding evidence" ON fix_strategies_finding_evidence;
CREATE POLICY "Users select own finding evidence"
  ON fix_strategies_finding_evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM fix_strategies_crawl_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );
