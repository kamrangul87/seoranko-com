-- Cache Page-2 title/meta and internal-link suggestions computed on the daily
-- GSC sync. Additive column — no drops. Service-role writes; server routes read.
ALTER TABLE public.gsc_connections
  ADD COLUMN IF NOT EXISTS page2_suggestions jsonb;

COMMENT ON COLUMN public.gsc_connections.page2_suggestions IS
  'Precomputed Page-2 suggestions (title/meta + internal links) for top opportunities. Observational only — Create PR remains a user action.';
