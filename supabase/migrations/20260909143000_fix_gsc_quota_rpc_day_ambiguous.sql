-- Fix ambiguous "day" in reserve_gsc_inspection_quota.
-- RETURNS TABLE (..., day DATE, ...) puts an output variable named day in
-- plpgsql scope, so bare `day` in UPDATE/WHERE was ambiguous vs the table column.
-- Keep the same return shape (drop + recreate) and qualify table references as q.day.

DROP FUNCTION IF EXISTS reserve_gsc_inspection_quota(UUID, UUID, TEXT, INTEGER, INTEGER);

CREATE FUNCTION reserve_gsc_inspection_quota(
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
    UPDATE gsc_inspection_quota_usage q
    SET exhausted_at = COALESCE(q.exhausted_at, NOW()),
        quota_exhausted_count = q.quota_exhausted_count + 1,
        updated_at = NOW()
    WHERE q.property_url = p_property_url AND q.day = v_day;
    RETURN QUERY SELECT 0, 0, v_day, v_used, TRUE;
    RETURN;
  END IF;

  v_reserved := LEAST(p_n, v_remaining);
  UPDATE gsc_inspection_quota_usage q
  SET requests_used = q.requests_used + v_reserved,
      attempted = q.attempted + v_reserved,
      exhausted_at = CASE
        WHEN q.requests_used + v_reserved >= p_soft_cap THEN COALESCE(q.exhausted_at, NOW())
        ELSE q.exhausted_at
      END,
      updated_at = NOW()
  WHERE q.property_url = p_property_url AND q.day = v_day
  RETURNING q.requests_used INTO v_used;

  v_remaining := GREATEST(0, p_soft_cap - v_used);
  RETURN QUERY SELECT v_reserved, v_remaining, v_day, v_used, (v_remaining <= 0);
END;
$$;

REVOKE ALL ON FUNCTION reserve_gsc_inspection_quota(UUID, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_gsc_inspection_quota(UUID, UUID, TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION reserve_gsc_inspection_quota(UUID, UUID, TEXT, INTEGER, INTEGER) IS
  'Atomically reserve URL Inspection quota for a property-day. Table columns referenced as q.day to avoid clash with OUT param day.';
