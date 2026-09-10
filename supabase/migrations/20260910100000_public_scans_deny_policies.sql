-- public_scans: explicit deny policies for browser roles.
-- Additive only. Service-role API routes continue to bypass RLS (Supabase default).
-- House rule: RLS enabled AND at least one policy. Zero policies was incomplete.

ALTER TABLE public_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_scans_deny_anon ON public_scans;
CREATE POLICY public_scans_deny_anon
  ON public_scans
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS public_scans_deny_authenticated ON public_scans;
CREATE POLICY public_scans_deny_authenticated
  ON public_scans
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public_scans IS
  'Anonymous public Index Diagnosis scans. Written/read only via service-role API. RLS on; explicit deny-all policies for anon and authenticated. No browser grants.';
