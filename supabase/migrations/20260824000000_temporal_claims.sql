-- C04 (temporal-claims spec) — registry for time-anchored claims that
-- passed the same-sentence citation check at generation time. Distinct
-- from articles.time_anchored_claims (an earlier, looser JSONB record with
-- document-wide citation binding and a 180-day window) — this is the
-- stricter same-sentence rule's own registry, with a 90-day review window,
-- feeding the freshness job in src/lib/temporal-claims-freshness.ts.
CREATE TABLE IF NOT EXISTS temporal_claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  source_url TEXT NOT NULL,
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  review_by TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'flagged', 'resolved')),
  last_verified_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_temporal_claims_review_due
  ON temporal_claims(review_by) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_temporal_claims_article
  ON temporal_claims(article_id);

ALTER TABLE temporal_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own temporal claims" ON temporal_claims;
CREATE POLICY "Users manage own temporal claims"
ON temporal_claims FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE temporal_claims IS
  'Time-anchored claims (C04) that passed the same-sentence citation check at generation time, one row per claim. review_by = detected_at + 90 days; the freshness job re-checks source_url still resolves and flags drift for the weekly digest — it never auto-rewrites the article.';
COMMENT ON COLUMN temporal_claims.status IS
  'active = due for re-check by review_by. flagged = freshness job found the source no longer resolves; needs human review. resolved = a human reviewed and cleared it.';
