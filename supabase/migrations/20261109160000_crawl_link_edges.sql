-- Internal link edges captured during the existing findings crawl
-- (Audit page, chunked, cap 2000). Additive only — no drops.
-- Apply on hosted: supabase db push  OR  run this file in the SQL editor
-- of project ddfboapzwclecbdjoqex. Do not rewrite historical migrations.

CREATE TABLE IF NOT EXISTS public.fix_strategies_crawl_link_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.fix_strategies_crawl_runs(id) ON DELETE CASCADE,
  site_id uuid NULL REFERENCES public.connected_sites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  target_url text NOT NULL,
  href_raw text NOT NULL,
  anchor_text text NOT NULL DEFAULT '',
  is_nofollow boolean NOT NULL DEFAULT false,
  target_http_status int NULL,
  target_final_url text NULL,
  is_redirect boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source_url, target_url, href_raw)
);

CREATE INDEX IF NOT EXISTS idx_fs_crawl_link_edges_run
  ON public.fix_strategies_crawl_link_edges(run_id);
CREATE INDEX IF NOT EXISTS idx_fs_crawl_link_edges_site
  ON public.fix_strategies_crawl_link_edges(site_id)
  WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fs_crawl_link_edges_target
  ON public.fix_strategies_crawl_link_edges(run_id, target_url);

ALTER TABLE public.fix_strategies_crawl_link_edges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fix_strategies_crawl_link_edges FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fix_strategies_crawl_link_edges TO service_role;

-- User-session reads of their own sites' crawl edges (RLS).
GRANT SELECT ON public.fix_strategies_crawl_link_edges TO authenticated;

DROP POLICY IF EXISTS "Users select own crawl link edges" ON public.fix_strategies_crawl_link_edges;
CREATE POLICY "Users select own crawl link edges"
  ON public.fix_strategies_crawl_link_edges FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.fix_strategies_crawl_link_edges IS
  'Internal <a href> edges extracted during the findings crawl. One row per source/target/href on a run.';
