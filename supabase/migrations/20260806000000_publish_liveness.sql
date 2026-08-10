-- Real Publishing & Verification, Phase A: liveness state machine columns.
--
-- Confirmed via a full repo grep (live_status|liveness|publish_status|
-- platform_post_id) that none of this existed anywhere before this
-- migration — genuinely new ground, no prior column to migrate off.
--
-- Landed on `pages` rather than `articles` or a new table: `pages` is
-- already the stage-tracking shadow record (see 20260730000002_pages.sql's
-- own comment — "§9 rule 5: No rewrites. Wire existing code into the
-- line.") with stage 6 = Publish, 7 = Monitor already reserved for exactly
-- this. `pages.url`/`pages.published_at` already exist and are reused as-is
-- (no live_url/published_at duplicate columns here) — only what's genuinely
-- new is added: which platform, the platform's own post/item identifier,
-- the liveness state itself, and an append-only history log matching the
-- existing site_autofix_log pattern (verified BOOLEAN + verification_result
-- JSONB) for auditability.

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS publish_platform TEXT
    CHECK (publish_platform IS NULL OR publish_platform IN ('wordpress', 'shopify', 'webflow', 'github', 'universal-tag')),
  ADD COLUMN IF NOT EXISTS platform_post_id TEXT,
  ADD COLUMN IF NOT EXISTS liveness_state TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (liveness_state IN ('CREATED', 'PUBLISH_REQUESTED', 'BUILD_PENDING', 'LIVE_UNVERIFIED', 'LIVE_VERIFIED', 'FAILED')),
  ADD COLUMN IF NOT EXISTS liveness_updated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS liveness_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Phase H's human-approval gate — enforced in the /api/publish route
  -- itself, not just recorded here, but kept as a real column (not derived)
  -- so it's auditable who approved what and when, matching this table's
  -- existing RLS (auth.uid() = user_id — only the owning user can set it).
  ADD COLUMN IF NOT EXISTS publish_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publish_approved_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_pages_liveness_state ON pages(liveness_state)
  WHERE liveness_state NOT IN ('LIVE_VERIFIED', 'FAILED');

COMMENT ON COLUMN pages.liveness_state IS
  'Real Publishing & Verification Phase A/B. CREATED -> PUBLISH_REQUESTED -> BUILD_PENDING -> LIVE_UNVERIFIED -> LIVE_VERIFIED, plus FAILED. Only Phase B''s HTTP verification loop may set LIVE_VERIFIED — publish() succeeding alone never does. See src/lib/publisher-adapters/liveness-state-machine.ts for the authoritative transition table.';
COMMENT ON COLUMN pages.liveness_history IS
  'Append-only log of every liveness transition: [{at, event, from, to, detail}]. Mirrors site_autofix_log''s verification_result pattern for auditability.';
COMMENT ON COLUMN pages.publish_approved_by IS
  'Phase H — default-on human review gate. /api/publish refuses to call a publisher adapter unless this is set, regardless of Quality Gate score.';
