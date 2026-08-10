-- Phase H's near-duplicate/volume-throttle safeguards need to scope
-- "other articles on this same site" — pages currently only links to
-- articles (article_id), never the connected site it was published to.
-- Small, additive column, same REFERENCES/ON DELETE pattern already used
-- for article_id and cluster_id on this table.

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES connected_sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id);

COMMENT ON COLUMN pages.site_id IS
  'Which connected_sites row this was published to — set by /api/publish. Used to scope Phase H''s near-duplicate and volume-throttle checks to "this site", not the whole user account.';
