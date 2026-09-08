-- Orphan remote migration history row (version 20260908072925).
-- Recorded on hosted project ddfboapzwclecbdjoqex without a matching file in git,
-- which broke `supabase db push` / Vercel production builds with:
--   Remote migration versions not found in local migrations directory.
-- This no-op file aligns local history with remote. It does not change schema.
-- Prefer `supabase migration repair --status reverted 20260908072925` if the
-- remote row should be removed instead; keep this file until that repair lands.
SELECT 1;
