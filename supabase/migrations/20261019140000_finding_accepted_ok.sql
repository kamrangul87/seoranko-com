-- Human-review "Mark as OK": accepted findings leave Needs you until the
-- observation fingerprint changes (page/content changed → comes back).

ALTER TABLE fix_strategies_findings
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS accepted_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_fingerprint TEXT NULL;

COMMENT ON COLUMN fix_strategies_findings.accepted_at IS
  'When a human marked this finding OK (Needs you → Reviewed and accepted).';
COMMENT ON COLUMN fix_strategies_findings.accepted_by IS
  'auth.users id of who marked the finding OK.';
COMMENT ON COLUMN fix_strategies_findings.accepted_fingerprint IS
  'Hash of detail+pageUrl+evidence at accept time; cleared when upsert sees a different fingerprint.';

CREATE INDEX IF NOT EXISTS idx_fs_findings_accepted_at
  ON fix_strategies_findings(site_id, accepted_at)
  WHERE accepted_at IS NOT NULL;
