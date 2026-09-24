-- Render-cost hardening: cumulative headless render time per crawl run.
-- RLS: column on existing RLS-protected table (no new table).

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS total_render_time_ms INT NOT NULL DEFAULT 0;
