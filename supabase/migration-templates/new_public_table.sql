-- TEMPLATE: new table in public (copy into supabase/migrations/YYYYMMDDHHMMSS_name.sql)
--
-- Supabase (from 30 Oct 2026): new public tables do NOT get automatic Data API
-- grants. Every CREATE TABLE in public MUST, in the same migration:
--   1. ENABLE ROW LEVEL SECURITY
--   2. GRANT to service_role (SELECT, INSERT, UPDATE, DELETE — or ALL)
--   3. authenticated: only if the app uses the user session against this table
--      (then add RLS policies). Otherwise REVOKE from authenticated.
--   4. anon: nothing, unless the table is genuinely public (state why below).
--
-- Do not edit this template file as a live migration — filenames starting with
-- non-timestamp are ignored by check:migration-grants / not applied by db push.

-- CREATE TABLE IF NOT EXISTS public.YOUR_TABLE (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id uuid NOT NULL REFERENCES auth.users (id),
--   created_at timestamptz NOT NULL DEFAULT now()
-- );

-- ALTER TABLE public.YOUR_TABLE ENABLE ROW LEVEL SECURITY;

-- -- Default: service-role only (cron / Fix Agent / server routes).
-- REVOKE ALL ON public.YOUR_TABLE FROM anon, authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.YOUR_TABLE TO service_role;

-- -- Optional: user-session access (uncomment + add policies).
-- -- GRANT SELECT, INSERT, UPDATE, DELETE ON public.YOUR_TABLE TO authenticated;
-- -- CREATE POLICY your_table_owner_all ON public.YOUR_TABLE
-- --   FOR ALL TO authenticated
-- --   USING (user_id = auth.uid())
-- --   WITH CHECK (user_id = auth.uid());

-- -- anon: do not grant unless genuinely public. If you must:
-- -- GRANT SELECT ON public.YOUR_TABLE TO anon; -- reason: <why this is public>
