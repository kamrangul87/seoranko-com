-- Source-file resolution for Fix Agent transforms.
-- Exactly one static candidate + exact evidence match → path + blob SHA.
-- resolved_at already means finding-status lifecycle; use source_resolved_at.

ALTER TABLE fix_strategies_findings
  ADD COLUMN IF NOT EXISTS source_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_blob_sha TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS source_unresolved_reason TEXT NULL
    CHECK (
      source_unresolved_reason IS NULL
      OR source_unresolved_reason IN (
        'no-static-file',
        'multiple-candidates',
        'evidence-not-found',
        'evidence-ambiguous'
      )
    );

COMMENT ON COLUMN fix_strategies_findings.source_path IS
  'Repo-relative static file path from resolveSourceFile. Required (with source_blob_sha) before a finding may be auto-fixable.';
COMMENT ON COLUMN fix_strategies_findings.source_blob_sha IS
  'Git blob SHA of source_path at resolution time. Re-resolve when the tip blob SHA changes.';
COMMENT ON COLUMN fix_strategies_findings.source_resolved_at IS
  'When source_path + source_blob_sha were last confirmed. Distinct from status resolved_at.';
COMMENT ON COLUMN fix_strategies_findings.source_unresolved_reason IS
  'no-static-file | multiple-candidates | evidence-not-found | evidence-ambiguous when resolution failed.';

CREATE INDEX IF NOT EXISTS idx_fix_strategies_findings_source_path
  ON fix_strategies_findings (site_id, source_path)
  WHERE source_path IS NOT NULL;
