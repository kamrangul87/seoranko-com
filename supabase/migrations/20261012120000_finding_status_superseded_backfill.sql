-- Allow retiring duplicate group findings as superseded (not resolved).
-- Representative page_url drift historically created two open rows for the
-- same topic+verdict+declaration_site / member set; keep one, supersede rest.

ALTER TABLE fix_strategies_findings
  DROP CONSTRAINT IF EXISTS fix_strategies_findings_status_check;

ALTER TABLE fix_strategies_findings
  ADD CONSTRAINT fix_strategies_findings_status_check
  CHECK (status IN ('open', 'resolved', 'regressed', 'superseded'));

COMMENT ON COLUMN fix_strategies_findings.status IS
  'open = currently detected or never resolved; resolved = absent from a later complete-coverage crawl of the same scope; regressed = a resolved finding reappeared; superseded = duplicate group row retired in favour of the canonical representative. Never inferred from a partial run.';

-- Pathname length for representative ordering (shortest path, then lex).
CREATE OR REPLACE FUNCTION _finding_pathname_len(u text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN u IS NULL OR u = '' THEN 0
    WHEN u ~ '^https?://[^/]+' THEN
      length(COALESCE(NULLIF(substring(u from '^https?://[^/]+(/[^?#]*)'), ''), '/'))
    ELSE length(split_part(split_part(u, '?', 1), '#', 1))
  END;
$$;

-- 1) Collapsible groups keyed by declaration_site (topics 8–12, 33, 38, 42, 49, …)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE(site_id::text, ''),
        COALESCE(detect_origin, ''),
        COALESCE(user_id::text, ''),
        topic_id,
        verdict,
        declaration_site
      ORDER BY
        _finding_pathname_len(page_url) ASC,
        page_url ASC NULLS LAST,
        first_seen_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM fix_strategies_findings
  WHERE status IN ('open', 'regressed')
    AND bucket <> 'internal'
    AND declaration_site IS NOT NULL
    AND affected_url_count > 1
)
UPDATE fix_strategies_findings f
SET
  status = 'superseded',
  updated_at = NOW()
FROM ranked r
WHERE f.id = r.id
  AND r.rn > 1
  AND f.status IN ('open', 'regressed');

-- 2) Multi-member groups without declaration_site — same sorted member set.
WITH keyed AS (
  SELECT
    id,
    COALESCE(site_id::text, '') AS scope_site,
    COALESCE(detect_origin, '') AS scope_origin,
    COALESCE(user_id::text, '') AS scope_user,
    topic_id,
    verdict,
    (
      SELECT string_agg(m, ',' ORDER BY _finding_pathname_len(m), m)
      FROM jsonb_array_elements_text(
        COALESCE(evidence_values->'memberUrls', '[]'::jsonb)
      ) AS m
    ) AS members_key,
    page_url,
    first_seen_at
  FROM fix_strategies_findings
  WHERE status IN ('open', 'regressed')
    AND bucket <> 'internal'
    AND declaration_site IS NULL
    AND jsonb_typeof(evidence_values->'memberUrls') = 'array'
    AND jsonb_array_length(evidence_values->'memberUrls') > 1
),
ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY scope_site, scope_origin, scope_user, topic_id, verdict, members_key
      ORDER BY
        _finding_pathname_len(page_url) ASC,
        page_url ASC NULLS LAST,
        first_seen_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM keyed
  WHERE members_key IS NOT NULL AND members_key <> ''
)
UPDATE fix_strategies_findings f
SET
  status = 'superseded',
  updated_at = NOW()
FROM ranked r
WHERE f.id = r.id
  AND r.rn > 1
  AND f.status IN ('open', 'regressed');

DROP FUNCTION IF EXISTS _finding_pathname_len(text);
