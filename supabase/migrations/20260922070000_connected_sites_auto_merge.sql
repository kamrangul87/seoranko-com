-- Opt-in auto-merge for findings fix-flow (default OFF).
-- Customer-repo PRs merge only when this is true AND every auto-merge gate holds.

ALTER TABLE connected_sites
  ADD COLUMN IF NOT EXISTS auto_merge_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN connected_sites.auto_merge_enabled IS
  'When true, findings fix-flow may merge an auto-fixable single-file PR after CI green + preview verify. Default OFF — human merges otherwise.';

-- Autodun: opt in (exact host; www stripped at write time so domain is autodun.com).
UPDATE connected_sites
SET auto_merge_enabled = true
WHERE lower(regexp_replace(domain, '^www\.', '')) = 'autodun.com';

-- Fix-flow session fields for auto-merge / production verify / revert.
ALTER TABLE fix_strategies_fix_flows
  ADD COLUMN IF NOT EXISTS auto_merged BOOLEAN,
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merge_sha TEXT,
  ADD COLUMN IF NOT EXISTS production_verify_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS production_verify_detail TEXT,
  ADD COLUMN IF NOT EXISTS revert_pr_url TEXT,
  ADD COLUMN IF NOT EXISTS revert_pr_number INT,
  ADD COLUMN IF NOT EXISTS needs_human_attention BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_detail TEXT,
  ADD COLUMN IF NOT EXISTS auto_merge_blocked_reason TEXT;

COMMENT ON COLUMN fix_strategies_fix_flows.auto_merged IS
  'True when the product merged the customer PR under auto_merge_enabled gates.';
COMMENT ON COLUMN fix_strategies_fix_flows.needs_human_attention IS
  'True when production verify failed after auto-merge (revert PR opened) or another flag.';
