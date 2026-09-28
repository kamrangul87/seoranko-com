-- Security audit fix (live-verified, not advisor-lint): five public-schema
-- functions were EXECUTE-grantable to `anon`/`authenticated` via PostgREST
-- RPC. Root cause, confirmed by direct has_function_privilege() query: this
-- Supabase project's hosted Postgres has a default-privileges rule that
-- auto-grants EXECUTE on every newly created function in `public` to
-- anon/authenticated/service_role. `REVOKE ALL ... FROM PUBLIC` (as used in
-- 20260924160000_fix_strategies_crawl_quota.sql) does NOT undo this --
-- anon/authenticated hold their own explicit grants independent of the
-- PUBLIC pseudo-role, so each must be revoked from by name.
--
-- Full-schema audit (direct privilege query against every function in
-- public, not advisors) found five functions actually affected:
--
--   fix_strategies_try_reserve_crawl_start(uuid, integer)  SECURITY DEFINER
--   fix_strategies_release_crawl_start(uuid)               SECURITY DEFINER
--     -- CRITICAL: bypasses RLS entirely. Any unauthenticated caller could
--     -- reserve/release another user's daily crawl-start quota via
--     -- POST /rest/v1/rpc/... with an arbitrary p_user_id.
--
--   handle_new_user()                                       SECURITY DEFINER
--     -- Returns `trigger`; Postgres refuses to invoke a trigger-returning
--     -- function outside trigger context, so this was not actually
--     -- RPC-exploitable, and revoking EXECUTE does not affect the
--     -- on_auth_user_created trigger (trigger firing does not require the
--     -- firing session to hold EXECUTE on the function). Revoked anyway on
--     -- the owner's explicit instruction and as defense in depth.
--
--   reserve_gsc_inspection_quota(uuid, uuid, text, integer, integer)
--   record_gsc_inspection_quota_outcome(text, date, integer, integer,
--     integer, boolean)
--     -- NOT security definer, so these run as the calling role. Checked:
--     -- gsc_inspection_quota_usage grants no INSERT/UPDATE to
--     -- anon/authenticated and has RLS enabled with zero policies, so a
--     -- direct anon/authenticated RPC call fails on the table write before
--     -- reaching any application logic -- not currently exploitable. Only
--     -- ever called (src/lib/gsc/inspection-scheduler.ts) with a
--     -- service-role client from a server-side cron path, so the RPC
--     -- grant was never needed. Revoked for the same reason as above.
--
-- Four zero-argument trigger functions (enforce_intervention_verified_
-- immutable, enforce_preregistration_immutable, prevent_preregistration_
-- mutation, prevent_verified_intervention_mutation, set_updated_at) were
-- also found anon/authenticated-executable and are equally inert via RPC
-- (trigger return type) for the same reason as handle_new_user. Revoked
-- here too so the live grant state matches "service-role/trigger-only" for
-- every internal function, not just the ones that happened to be
-- exploitable today -- see scripts/check-function-grants.mjs, added in
-- this PR, which now gates every future migration on this exact property.

REVOKE ALL ON FUNCTION fix_strategies_try_reserve_crawl_start(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fix_strategies_release_crawl_start(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reserve_gsc_inspection_quota(uuid, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_gsc_inspection_quota_outcome(text, date, integer, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_intervention_verified_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_preregistration_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prevent_preregistration_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prevent_verified_intervention_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC, anon, authenticated;

-- Restore service_role access for the functions the app actually calls via
-- RPC (crawl quota, GSC quota). The trigger functions and handle_new_user
-- need no explicit grant: trigger firing does not check EXECUTE privilege
-- on the invoking session, only on the function's own definition.
GRANT EXECUTE ON FUNCTION fix_strategies_try_reserve_crawl_start(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION fix_strategies_release_crawl_start(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION reserve_gsc_inspection_quota(uuid, uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION record_gsc_inspection_quota_outcome(text, date, integer, integer, integer, boolean) TO service_role;

-- Close the root cause for the path that matters, not just today's
-- symptom: `supabase db push` (this repo's only path from a merged
-- migration to production, via .github/workflows/supabase-migrate.yml)
-- connects as `postgres`, and that role's default-privileges row was the
-- one auto-granting EXECUTE to anon/authenticated on every function it
-- creates. This statement fixes that row -- verified empirically: a
-- function created as `postgres` after this ran EXECUTE-grants only to
-- postgres/service_role. New migrations must GRANT EXECUTE explicitly (as
-- this one does) for any role that legitimately needs to call a function
-- directly.
--
-- NOT covered, and outside what a migration or the available Postgres
-- role can fix: `pg_default_acl` also has a separate, more permissive row
-- owned by `supabase_admin` (Supabase's own reserved system role, used by
-- the dashboard SQL editor / Management API) that still auto-grants
-- anon/authenticated EXECUTE on functions IT creates. Attempting
-- `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` from this
-- connection fails with `permission denied to change default privileges`
-- -- only supabase_admin itself could change it. Practical mitigation:
-- never create functions via the Supabase dashboard SQL editor; use
-- migrations. scripts/check-function-grants.mjs (this PR) is the actual
-- backstop -- it checks live grants after every migration regardless of
-- which role created the function, so it still catches this class of
-- mistake if it happens anyway.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION fix_strategies_try_reserve_crawl_start(uuid, integer) IS
  'service_role only. Was anon/authenticated-executable via PostgREST RPC until 20260928090000 -- see that migration for the live-privilege audit.';
COMMENT ON FUNCTION fix_strategies_release_crawl_start(uuid) IS
  'service_role only. Was anon/authenticated-executable via PostgREST RPC until 20260928090000 -- see that migration for the live-privilege audit.';
