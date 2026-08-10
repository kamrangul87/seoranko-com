-- Real Publishing & Verification, Phase B: scheduling columns for the HTTP
-- verification loop's exponential backoff (30s, 1m, 2m, 5m, 15m, then
-- 30min steps up to a 60min ceiling — see
-- src/lib/publisher-adapters/liveness-verifier.ts's computeBackoff, the
-- authoritative implementation of this schedule).

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_check_at TIMESTAMP WITH TIME ZONE;

-- The verification cron sweeps rows due for a check — this index is what
-- makes that query cheap instead of a full scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_pages_next_check
  ON pages(next_check_at)
  WHERE liveness_state IN ('BUILD_PENDING', 'LIVE_UNVERIFIED');

COMMENT ON COLUMN pages.next_check_at IS
  'Phase B — when the HTTP verification loop should next check this page. NULL means not currently scheduled (e.g. still CREATED, or already LIVE_VERIFIED/FAILED).';
COMMENT ON COLUMN pages.verification_attempts IS
  'Phase B — count of HTTP verification attempts so far, used to look up the backoff schedule step and to compute elapsed time against the ceiling.';
COMMENT ON COLUMN pages.first_check_at IS
  'Phase B — timestamp of the first verification attempt, used to compute elapsed time against the 60min ceiling regardless of how the backoff steps landed.';
