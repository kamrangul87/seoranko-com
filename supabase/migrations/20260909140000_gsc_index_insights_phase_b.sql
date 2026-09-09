-- GSC Index Insights Phase B (runs after 20260909120000_gsc_url_inspections).
-- Atomic quota RPC, deferred queue, scheduler cursor, expanded evidence.
-- Index Insights stays read-only w.r.t. intervention_events / causal_results.

-- ── Expand gsc_url_inspections evidence columns ─────────────────────────────
ALTER TABLE gsc_url_inspections
  ADD COLUMN IF NOT EXISTS crawled_as TEXT,
  ADD COLUMN IF NOT EXISTS user_canonical_raw TEXT,
  ADD COLUMN IF NOT EXISTS user_canonical_normalized TEXT,
  ADD COLUMN IF NOT EXISTS google_canonical_raw TEXT,
  ADD COLUMN IF NOT EXISTS google_canonical_normalized TEXT,
  ADD COLUMN IF NOT EXISTS sitemap TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS referring_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS referring_urls_exhaustive BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rich_results_verdict TEXT,
  ADD COLUMN IF NOT EXISTS rich_results_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS index_diagnosis_run_id UUID,
  ADD COLUMN IF NOT EXISTS intervention_id UUID REFERENCES intervention_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_inspection_id UUID REFERENCES gsc_url_inspections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS historical_transitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS url_normalized TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'succeeded';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gsc_url_inspections_status_check'
  ) THEN
    ALTER TABLE gsc_url_inspections
      ADD CONSTRAINT gsc_url_inspections_status_check
      CHECK (status IN ('succeeded', 'deferred', 'failed', 'quota_exhausted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gsc_url_inspections_url_norm
  ON gsc_url_inspections(site_id, url_normalized, inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_url_inspections_intervention
  ON gsc_url_inspections(intervention_id)
  WHERE intervention_id IS NOT NULL;

COMMENT ON COLUMN gsc_url_inspections.referring_urls_exhaustive IS
  'False when Google omitted or truncated referring URLs — never treat absence as proof.';
COMMENT ON COLUMN gsc_url_inspections.intervention_id IS
  'Optional link to intervention_events for post-fix recrawl deltas. Read-only w.r.t. that table.';

-- ── Quota: property-level unique + counters ─────────────────────────────────
ALTER TABLE gsc_inspection_quota_usage
  ADD COLUMN IF NOT EXISTS attempted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS succeeded INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deferred INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_exhausted_count INTEGER NOT NULL DEFAULT 0;

-- Property-day uniqueness (dedupe across multiple site connections to same property)
ALTER TABLE gsc_inspection_quota_usage
  DROP CONSTRAINT IF EXISTS gsc_inspection_quota_usage_site_id_property_url_day_key;
CREATE UNIQUE INDEX IF NOT EXISTS gsc_inspection_quota_property_day_uidx
  ON gsc_inspection_quota_usage (property_url, day);

COMMENT ON TABLE gsc_inspection_quota_usage IS
  'Advisory per-property daily URL Inspection usage. Soft cap under Google 2000 QPD; HTTP 429 is authoritative.';

CREATE OR REPLACE FUNCTION reserve_gsc_inspection_quota(
  p_site_id UUID,
  p_user_id UUID,
  p_property_url TEXT,
  p_n INTEGER,
  p_soft_cap INTEGER DEFAULT 1950
)
RETURNS TABLE (
  reserved INTEGER,
  remaining INTEGER,
  day DATE,
  requests_used INTEGER,
  exhausted BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_day DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  v_used INTEGER := 0;
  v_reserved INTEGER := 0;
  v_remaining INTEGER := 0;
  v_exhausted BOOLEAN := FALSE;
BEGIN
  IF p_n IS NULL OR p_n < 1 THEN
    RETURN QUERY SELECT 0, GREATEST(0, p_soft_cap), v_day, 0, FALSE;
    RETURN;
  END IF;

  INSERT INTO gsc_inspection_quota_usage AS q (
    site_id, user_id, property_url, day, requests_used, attempted, updated_at
  ) VALUES (
    p_site_id, p_user_id, p_property_url, v_day, 0, 0, NOW()
  )
  ON CONFLICT (property_url, day) DO UPDATE
    SET updated_at = NOW(),
        site_id = EXCLUDED.site_id,
        user_id = EXCLUDED.user_id;

  SELECT q.requests_used, q.exhausted_at IS NOT NULL
    INTO v_used, v_exhausted
  FROM gsc_inspection_quota_usage q
  WHERE q.property_url = p_property_url AND q.day = v_day
  FOR UPDATE;

  v_remaining := GREATEST(0, p_soft_cap - v_used);
  IF v_exhausted OR v_remaining <= 0 THEN
    UPDATE gsc_inspection_quota_usage
    SET exhausted_at = COALESCE(exhausted_at, NOW()),
        quota_exhausted_count = quota_exhausted_count + 1,
        updated_at = NOW()
    WHERE property_url = p_property_url AND day = v_day;
    RETURN QUERY SELECT 0, 0, v_day, v_used, TRUE;
    RETURN;
  END IF;

  v_reserved := LEAST(p_n, v_remaining);
  UPDATE gsc_inspection_quota_usage
  SET requests_used = requests_used + v_reserved,
      attempted = attempted + v_reserved,
      exhausted_at = CASE
        WHEN requests_used + v_reserved >= p_soft_cap THEN COALESCE(exhausted_at, NOW())
        ELSE exhausted_at
      END,
      updated_at = NOW()
  WHERE property_url = p_property_url AND day = v_day
  RETURNING gsc_inspection_quota_usage.requests_used INTO v_used;

  v_remaining := GREATEST(0, p_soft_cap - v_used);
  RETURN QUERY SELECT v_reserved, v_remaining, v_day, v_used, (v_remaining <= 0);
END;
$$;

REVOKE ALL ON FUNCTION reserve_gsc_inspection_quota(UUID, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_gsc_inspection_quota(UUID, UUID, TEXT, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION record_gsc_inspection_quota_outcome(
  p_property_url TEXT,
  p_day DATE,
  p_succeeded INTEGER DEFAULT 0,
  p_failed INTEGER DEFAULT 0,
  p_deferred INTEGER DEFAULT 0,
  p_mark_exhausted BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE gsc_inspection_quota_usage
  SET succeeded = succeeded + GREATEST(0, p_succeeded),
      failed = failed + GREATEST(0, p_failed),
      deferred = deferred + GREATEST(0, p_deferred),
      quota_exhausted_count = quota_exhausted_count + CASE WHEN p_mark_exhausted THEN 1 ELSE 0 END,
      exhausted_at = CASE WHEN p_mark_exhausted THEN COALESCE(exhausted_at, NOW()) ELSE exhausted_at END,
      updated_at = NOW()
  WHERE property_url = p_property_url AND day = p_day;
END;
$$;

REVOKE ALL ON FUNCTION record_gsc_inspection_quota_outcome(TEXT, DATE, INTEGER, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_gsc_inspection_quota_outcome(TEXT, DATE, INTEGER, INTEGER, INTEGER, BOOLEAN) TO service_role;

CREATE TABLE IF NOT EXISTS gsc_inspection_deferred (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES gsc_connections(id) ON DELETE SET NULL,
  property_url TEXT NOT NULL,
  url TEXT NOT NULL,
  url_normalized TEXT NOT NULL,
  reason TEXT NOT NULL,
  http_status INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  intervention_id UUID REFERENCES intervention_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_url, url_normalized)
);

CREATE INDEX IF NOT EXISTS idx_gsc_inspection_deferred_next
  ON gsc_inspection_deferred(property_url, next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE gsc_inspection_deferred ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own gsc inspection deferred" ON gsc_inspection_deferred;
CREATE POLICY "Users read own gsc inspection deferred"
  ON gsc_inspection_deferred FOR SELECT
  USING (auth.uid() = user_id);
REVOKE ALL ON gsc_inspection_deferred FROM anon, authenticated;
GRANT SELECT ON gsc_inspection_deferred TO authenticated;

CREATE TABLE IF NOT EXISTS gsc_inspection_scheduler_cursor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL UNIQUE,
  site_id UUID REFERENCES connected_sites(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_connection_id UUID REFERENCES gsc_connections(id) ON DELETE SET NULL,
  last_run_at TIMESTAMPTZ,
  last_url_cursor TEXT,
  blocked_sample_offset INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gsc_inspection_scheduler_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gsc_inspection_scheduler_cursor FROM anon, authenticated;
