-- Track full discovery frontier vs enqueued/capped counts for partial status.
ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS urls_found INT NOT NULL DEFAULT 0;

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS url_cap INT NULL;

COMMENT ON COLUMN fix_strategies_crawl_runs.urls_found IS
  'Same-host sitemap locs found before product/test cap';
COMMENT ON COLUMN fix_strategies_crawl_runs.url_cap IS
  'Enqueue cap applied (CRAWL_MAX_DISCOVERED or maxUrls); null if uncapped';
COMMENT ON COLUMN fix_strategies_crawl_runs.urls_discovered IS
  'Locs actually enqueued (may be < urls_found when capped)';
