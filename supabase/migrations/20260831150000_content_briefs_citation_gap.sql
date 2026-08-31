-- Persist generated content briefs and link optional AI Visibility citation gaps.
-- ai_visibility_result_id is nullable: ordinary seed-keyword briefs have no gap.

CREATE TABLE IF NOT EXISTS content_briefs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES connected_sites(id) ON DELETE SET NULL,
  seed_keyword TEXT NOT NULL,
  mode TEXT,
  market TEXT,
  brief JSONB NOT NULL,
  ai_visibility_result_id UUID REFERENCES ai_visibility_results(id) ON DELETE SET NULL,
  citation_engine TEXT,
  citation_prompt TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_briefs_user ON content_briefs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_briefs_gap ON content_briefs(ai_visibility_result_id)
  WHERE ai_visibility_result_id IS NOT NULL;

ALTER TABLE content_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own content briefs" ON content_briefs;
CREATE POLICY "Users manage own content briefs"
ON content_briefs FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE content_briefs IS
  'Generated Content Briefs. ai_visibility_result_id links a brief that was created to close a citation gap.';
COMMENT ON COLUMN content_briefs.ai_visibility_result_id IS
  'Nullable FK to the AI Visibility result that triggered Fix this gap. NULL for ordinary seed briefs.';
