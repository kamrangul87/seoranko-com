-- Store Search Console top-row query+page daily metrics (final-window only).
-- Additive schema — no drops or rewrites. RLS + Data API grants included.
-- See supabase/migration-templates/new_public_table.sql for policy.

CREATE TABLE IF NOT EXISTS public.gsc_query_page_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES connected_sites(id) ON DELETE CASCADE,
  url text NOT NULL,
  query text NOT NULL,
  date date NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr double precision NOT NULL DEFAULT 0,
  avg_position double precision NOT NULL DEFAULT 0,
  is_final boolean NOT NULL DEFAULT FALSE,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, url, query, date)
);

CREATE INDEX IF NOT EXISTS idx_gqpd_site_date ON public.gsc_query_page_daily(site_id, date);
CREATE INDEX IF NOT EXISTS idx_gqpd_site_url ON public.gsc_query_page_daily(site_id, url);
CREATE INDEX IF NOT EXISTS idx_gqpd_site_query ON public.gsc_query_page_daily(site_id, query);

ALTER TABLE public.gsc_query_page_daily ENABLE ROW LEVEL SECURITY;

-- Default: service-role only (server routes / cron).
REVOKE ALL ON public.gsc_query_page_daily FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_query_page_daily TO service_role;

-- App reads via user session.
GRANT SELECT ON public.gsc_query_page_daily TO authenticated;

COMMENT ON TABLE public.gsc_query_page_daily IS
  'Top-row Search Analytics metrics by (query,page,date). Final rows only are used for comparative windows.';
