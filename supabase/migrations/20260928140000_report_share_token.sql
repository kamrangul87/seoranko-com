-- Item 5 — shareable, read-only, revocable per-site fix report link.
--
-- A separate trust surface from universal_tag_token (20260729000002),
-- which is already embedded in arbitrary third-party JS on a customer's
-- live site and used for a completely different purpose (the fix-queue
-- script tag). Reusing it here would mean anyone with page-source access
-- to a customer's site could also read their fix report. Opt-in and
-- NULL by default -- no site has a live link until the owner explicitly
-- creates one (POST /api/fix-strategies/reports/token), and revoking is
-- just nulling this column back out (owner's existing UPDATE access via
-- the "Users manage own sites" RLS policy already covers it -- no new
-- policy needed).
ALTER TABLE connected_sites
  ADD COLUMN IF NOT EXISTS report_share_token TEXT UNIQUE DEFAULT NULL;

COMMENT ON COLUMN connected_sites.report_share_token IS
  'Opt-in bearer token for the public, read-only, per-site fix report (Item 5). NULL = no live link. Owner generates/revokes via /api/fix-strategies/reports/token. Looked up with the service-role client only, same pattern as universal_tag_token -- see api/public/fix-report/[token]/route.ts.';
