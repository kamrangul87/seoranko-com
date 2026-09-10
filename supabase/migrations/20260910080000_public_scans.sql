-- Public Index Diagnosis scans (funnel tool — no auth).
-- Additive only. RLS enabled; no anon/authenticated direct table access —
-- service-role API routes write/read.

CREATE TABLE IF NOT EXISTS public_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  urls_discovered INT NOT NULL DEFAULT 0,
  urls_fetched INT NOT NULL DEFAULT 0,
  verdict_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  email TEXT NULL,
  ip_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_scans_ip_scanned
  ON public_scans (ip_hash, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_scans_domain
  ON public_scans (domain);

ALTER TABLE public_scans ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated — browser never reads this table directly.
REVOKE ALL ON public_scans FROM anon, authenticated;

COMMENT ON TABLE public_scans IS
  'Anonymous public Index Diagnosis scans. Written only via service-role API. RLS on; no grants to browser roles.';
