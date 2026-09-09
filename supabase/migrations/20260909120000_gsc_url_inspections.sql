-- GSC Index Insights: URL Inspection history + daily quota usage.
-- Historical inserts only (never verdicts change over time). Service-role writes.

-- ── gsc_url_inspections ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gsc_url_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES gsc_connections(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Google fields (exact strings from URL Inspection API when present)
  verdict TEXT,
  coverage_state TEXT,
  robots_txt_state TEXT,
  indexing_state TEXT,
  google_canonical TEXT,
  user_canonical TEXT,
  canonical_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  last_crawl_time TIMESTAMPTZ,
  page_fetch_state TEXT,
  raw_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Snapshot of our crawl + mechanical deltas at inspect time
  our_verdict TEXT,
  our_robots_blocked BOOLEAN,
  deltas JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_gsc_url_inspections_site_inspected
  ON gsc_url_inspections(site_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_url_inspections_site_url_inspected
  ON gsc_url_inspections(site_id, url, inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_url_inspections_user
  ON gsc_url_inspections(user_id);

ALTER TABLE gsc_url_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own gsc url inspections" ON gsc_url_inspections;
CREATE POLICY "Users read own gsc url inspections"
  ON gsc_url_inspections FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON gsc_url_inspections FROM anon, authenticated;
GRANT SELECT ON gsc_url_inspections TO authenticated;

COMMENT ON TABLE gsc_url_inspections IS
  'Historical Google URL Inspection API results per URL. Never overwrite — insert to track verdict changes.';
COMMENT ON COLUMN gsc_url_inspections.coverage_state IS
  'Google coverageState string verbatim (e.g. Submitted and indexed).';
COMMENT ON COLUMN gsc_url_inspections.deltas IS
  'Mechanical mismatches vs our crawl at inspect time (reason codes + evidence).';

-- ── gsc_inspection_quota_usage ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gsc_inspection_quota_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_url TEXT NOT NULL,
  day DATE NOT NULL,
  requests_used INTEGER NOT NULL DEFAULT 0 CHECK (requests_used >= 0),
  exhausted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, property_url, day)
);

CREATE INDEX IF NOT EXISTS idx_gsc_inspection_quota_site_day
  ON gsc_inspection_quota_usage(site_id, day DESC);

ALTER TABLE gsc_inspection_quota_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own gsc inspection quota" ON gsc_inspection_quota_usage;
CREATE POLICY "Users read own gsc inspection quota"
  ON gsc_inspection_quota_usage FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON gsc_inspection_quota_usage FROM anon, authenticated;
GRANT SELECT ON gsc_inspection_quota_usage TO authenticated;

COMMENT ON TABLE gsc_inspection_quota_usage IS
  'Per-property daily URL Inspection API usage. Soft cap 2000 QPD; degrade when exhausted.';
