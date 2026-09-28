-- Change Monitoring 3.2 — regression / post-fix fields on findings.
-- Builds on P1 resolution (status open|resolved|regressed + resolved_at).
-- Does NOT introduce a parallel lifecycle.
--
-- first_seen_at / last_seen_at already exist on fix_strategies_findings.
-- resolved_at already exists (P1). This migration adds the SEORANKO-fix
-- and regression timestamps plus post_fix_status.

ALTER TABLE fix_strategies_findings
  ADD COLUMN IF NOT EXISTS fixed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS verification_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS post_fix_status TEXT NULL
    CHECK (
      post_fix_status IS NULL
      OR post_fix_status IN ('verified', 'verify_failed', 'regressed')
    ),
  ADD COLUMN IF NOT EXISTS regression_observed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN fix_strategies_findings.fixed_at IS
  'When a SEORANKO fix (customer PR merge) landed. Null when the finding only resolved via crawl absence. Cross-ref FIX_VERIFY_OUTCOME_RECORD.md — do not duplicate ledger rows here.';
COMMENT ON COLUMN fix_strategies_findings.verification_at IS
  'When production (or preview) verify completed for a SEORANKO fix.';
COMMENT ON COLUMN fix_strategies_findings.post_fix_status IS
  'verified = SEORANKO fix production-verified; verify_failed = verify failed after fix; regressed = previously verified/fixed condition returned. Null = no SEORANKO fix recorded.';
COMMENT ON COLUMN fix_strategies_findings.regression_observed_at IS
  'Set when status transitions resolved → regressed (condition reappeared). Not cleared on later re-resolve.';
