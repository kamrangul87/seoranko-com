-- Resumable post-crawl: phase cursor + once-per-run sitemap inspection / link graph.
-- Whole-site detectors resume across ticks; never mark complete with phases outstanding.

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS post_crawl_phase TEXT NULL;

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS post_crawl_cursor JSONB NULL;

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS sitemap_inspection JSONB NULL;

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS link_graph JSONB NULL;

COMMENT ON COLUMN fix_strategies_crawl_runs.post_crawl_phase IS
  'Resumable post-crawl phase id (persist_inspection → … → rollup → done). Null while URL frontier is still draining.';

COMMENT ON COLUMN fix_strategies_crawl_runs.post_crawl_cursor IS
  'Phase-local cursor (e.g. topic 26 locIndex). Cleared when advancing to the next phase.';

COMMENT ON COLUMN fix_strategies_crawl_runs.sitemap_inspection IS
  'Persisted inspectSiteSitemaps result (once per run). Later ticks read this — never rebuild.';

COMMENT ON COLUMN fix_strategies_crawl_runs.link_graph IS
  'Persisted buildInternalLinkGraph result (once per run, full post-drain snapshot).';
