-- HTML snapshots for full-run link graph + discovery seed breakdown.
ALTER TABLE fix_strategies_crawl_url_jobs
  ADD COLUMN IF NOT EXISTS body_html TEXT NULL;

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS discovery_seeds JSONB NULL;

COMMENT ON COLUMN fix_strategies_crawl_url_jobs.body_html IS
  'Served HTML snapshot for topic 43 full-run link graph';
COMMENT ON COLUMN fix_strategies_crawl_runs.discovery_seeds IS
  'Seed counts: fromRobotsSitemaps, fromSitemapFallback, fromHomepage, fromLinkGraph';
