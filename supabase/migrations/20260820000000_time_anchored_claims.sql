-- C04: persist detected time-anchored claims per article so a background
-- job can re-check them by their reviewBy date instead of re-scanning
-- every article from scratch.
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS time_anchored_claims JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN articles.time_anchored_claims IS
  'Array of {claim, sourceUrl, assertedOn, reviewBy} — time-anchored figures (Quality Gate rule C04) detected at generation time, for follow-up re-verification by reviewBy.';
