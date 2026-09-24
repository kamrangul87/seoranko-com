-- Page render evidence for findings crawl (render guard).
-- Stores raw vs rendered hashes + mode per URL job. RLS: owner SELECT via run.

CREATE TABLE IF NOT EXISTS fix_strategies_page_render_evidence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES fix_strategies_crawl_runs(id) ON DELETE CASCADE,
  job_id UUID NULL REFERENCES fix_strategies_crawl_url_jobs(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  render_mode TEXT NOT NULL
    CHECK (render_mode IN ('http', 'rendered', 'render_failed')),
  raw_html_hash TEXT NOT NULL,
  rendered_html_hash TEXT NULL,
  render_needed BOOLEAN NOT NULL DEFAULT false,
  render_needed_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  render_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, url)
);

CREATE INDEX IF NOT EXISTS idx_fs_page_render_run
  ON fix_strategies_page_render_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_fs_page_render_user
  ON fix_strategies_page_render_evidence(user_id);

ALTER TABLE fix_strategies_crawl_url_jobs
  ADD COLUMN IF NOT EXISTS render_mode TEXT NULL
    CHECK (render_mode IS NULL OR render_mode IN ('http', 'rendered', 'render_failed')),
  ADD COLUMN IF NOT EXISTS raw_html_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS rendered_html_hash TEXT NULL;

ALTER TABLE fix_strategies_crawl_runs
  ADD COLUMN IF NOT EXISTS pages_rendered INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pages_render_failed INT NOT NULL DEFAULT 0;

ALTER TABLE fix_strategies_page_render_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fs_page_render_select_own ON fix_strategies_page_render_evidence;
CREATE POLICY fs_page_render_select_own
  ON fix_strategies_page_render_evidence
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE for authenticated — service role writes only.
