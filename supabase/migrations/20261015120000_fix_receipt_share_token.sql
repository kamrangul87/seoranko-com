-- Per-item Fix Receipt share links (private by default).
-- Additive only: nullable unique token on run items that are verified live.

ALTER TABLE fix_strategies_run_items
  ADD COLUMN IF NOT EXISTS share_token TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_run_items_share_token
  ON fix_strategies_run_items (share_token)
  WHERE share_token IS NOT NULL;

COMMENT ON COLUMN fix_strategies_run_items.share_token IS
  'Opaque share token for a public Fix Receipt URL; null = private.';
