-- Detection-only crawls: public URL, no connected_sites row, no site credentials.
-- site_id becomes nullable; detect_origin scopes findings when site_id IS NULL.

ALTER TABLE fix_strategies_crawl_runs
  ALTER COLUMN site_id DROP NOT NULL;

ALTER TABLE fix_strategies_findings
  ALTER COLUMN site_id DROP NOT NULL;

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS detect_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detect_origin TEXT NULL;

ALTER TABLE fix_strategies_findings
  ADD COLUMN IF NOT EXISTS detect_origin TEXT NULL;

-- Replace site-scoped unique with partial indexes so detect-only rows
-- (site_id NULL) can still dedupe by (user, origin, topic, rollup).
ALTER TABLE fix_strategies_findings
  DROP CONSTRAINT IF EXISTS fix_strategies_findings_site_id_topic_id_rollup_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_findings_site_topic_rollup
  ON fix_strategies_findings (site_id, topic_id, rollup_key)
  WHERE site_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_findings_detect_topic_rollup
  ON fix_strategies_findings (user_id, detect_origin, topic_id, rollup_key)
  WHERE site_id IS NULL AND detect_origin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fs_crawl_runs_detect_origin
  ON fix_strategies_crawl_runs (user_id, detect_origin)
  WHERE detect_only = true;

CREATE INDEX IF NOT EXISTS idx_fs_findings_detect_origin
  ON fix_strategies_findings (user_id, detect_origin)
  WHERE site_id IS NULL;
