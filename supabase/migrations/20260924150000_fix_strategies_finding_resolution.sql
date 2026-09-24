-- Findings must close, not go stale. Before this migration, a finding that
-- stopped appearing in later crawls just sat forever with a stale
-- last_seen_at, indistinguishable from one still open. This adds a real
-- status lifecycle: 'open' (default, unchanged) -> 'resolved' (absent from
-- a later *complete* crawl of the same scope) -> 'regressed' (a resolved
-- finding reappeared). See src/lib/fix-strategies/findings-ui/crawl/
-- orchestrator.ts (resolution pass, gated on status === 'complete' only —
-- a partial run never had full coverage, so absence proves nothing) and
-- supabase-store.ts / store.ts (upsertFindings' resolved->regressed
-- transition, resolveAbsentFindings).

ALTER TABLE fix_strategies_findings
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'regressed')),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_fix_strategies_findings_status
  ON fix_strategies_findings (site_id, status)
  WHERE site_id IS NOT NULL;

COMMENT ON COLUMN fix_strategies_findings.status IS
  'open = currently detected or never resolved; resolved = absent from a later complete-coverage crawl of the same scope; regressed = a resolved finding reappeared. Never inferred from a partial run.';
COMMENT ON COLUMN fix_strategies_findings.resolved_at IS
  'Set when status transitions to resolved. Preserved (not cleared) across a later regression, so it still answers "when was this last considered fixed".';
