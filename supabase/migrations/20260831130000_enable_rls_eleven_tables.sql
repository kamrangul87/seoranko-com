-- Track RLS that was applied directly on the hosted Supabase project
-- (ddfboapzwclecbdjoqex) for the 11 previously-unprotected tables.
--
-- Verified against live via PostgREST (anon key):
--   - All 11 tables reject unauthenticated writes with 42501 (RLS enforced)
--   - site_audit_results.user_id and seo_sites.user_id exist (owner policies)
--   - image_generation_logs has no user_id (service-role only; no client policies)
-- Exact policy names on live cannot be dumped without the service role /
-- DB password; names below follow this repo's migration conventions and
-- match the applied behaviour.
--
-- Idempotent: safe to re-run. On a DB that already has these policies under
-- different names, DROP/CREATE only affects the names listed here.

-- ── 1. Owner-based (user_id) ────────────────────────────────────────────────

ALTER TABLE site_audit_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own site_audit_results" ON site_audit_results;
CREATE POLICY "Users manage own site_audit_results"
ON site_audit_results
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

ALTER TABLE seo_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own seo_sites" ON seo_sites;
CREATE POLICY "Users manage own seo_sites"
ON seo_sites
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ── 2. Backend / service-role only (RLS on, no client policies) ─────────────
-- image_generation_logs has no user_id; writers use SUPABASE_SERVICE_ROLE_KEY
-- which bypasses RLS. Anon/authenticated get no policies → no access.

ALTER TABLE image_generation_logs ENABLE ROW LEVEL SECURITY;

-- Intentionally no CREATE POLICY for anon/authenticated.

-- ── 3. Read-only for authenticated (no client write policies) ───────────────
-- Cache / history / reference tables. Writes remain service-role only.

ALTER TABLE audit_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read audit_history" ON audit_history;
CREATE POLICY "Authenticated read audit_history"
ON audit_history
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE ai_citation_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read ai_citation_tests" ON ai_citation_tests;
CREATE POLICY "Authenticated read ai_citation_tests"
ON ai_citation_tests
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE score_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read score_history" ON score_history;
CREATE POLICY "Authenticated read score_history"
ON score_history
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE scheduled_citation_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read scheduled_citation_tests" ON scheduled_citation_tests;
CREATE POLICY "Authenticated read scheduled_citation_tests"
ON scheduled_citation_tests
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE entity_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read entity_cache" ON entity_cache;
CREATE POLICY "Authenticated read entity_cache"
ON entity_cache
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE serp_intent_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read serp_intent_cache" ON serp_intent_cache;
CREATE POLICY "Authenticated read serp_intent_cache"
ON serp_intent_cache
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE ranko_winnability_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read ranko_winnability_cache" ON ranko_winnability_cache;
CREATE POLICY "Authenticated read ranko_winnability_cache"
ON ranko_winnability_cache
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE treatments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read treatments" ON treatments;
CREATE POLICY "Authenticated read treatments"
ON treatments
FOR SELECT
TO authenticated
USING (true);

COMMENT ON TABLE image_generation_logs IS
  'RLS enabled with no client policies — service-role writes only.';
