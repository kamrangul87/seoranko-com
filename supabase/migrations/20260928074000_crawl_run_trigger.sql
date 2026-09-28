-- Change Monitoring 3.3 — distinguish scheduled weekly recrawls from manual starts.
-- Used to enforce once-per-UTC-week scheduling and "skip after two failed
-- scheduled crawls" without mistaking owner-triggered runs for cron work.

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS trigger TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger IN ('manual', 'scheduled'));

CREATE INDEX IF NOT EXISTS idx_fs_crawl_runs_site_trigger_created
  ON fix_strategies_crawl_runs (site_id, trigger, created_at DESC)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fs_crawl_runs_detect_trigger_created
  ON fix_strategies_crawl_runs (user_id, detect_origin, trigger, created_at DESC)
  WHERE site_id IS NULL;

COMMENT ON COLUMN fix_strategies_crawl_runs.trigger IS
  'manual = owner/API start; scheduled = Change Monitoring weekly recrawl cron.';
