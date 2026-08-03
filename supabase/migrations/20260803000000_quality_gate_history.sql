-- Fix Recurring Generation Defects at the Source — Fix 5 (recurring-issue tracker)
--
-- Every Quality Gate issue found, logged per generation run. Used to detect
-- recurring pipeline bugs (same issue category in 3+ of the last 5 runs)
-- vs one-off content issues, per src/lib/recurring-issue-detector.ts.

CREATE TABLE IF NOT EXISTS quality_gate_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID,
  issue_category TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qg_history_user_category
  ON quality_gate_history(user_id, issue_category, created_at DESC);

ALTER TABLE quality_gate_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own quality gate history" ON quality_gate_history;
CREATE POLICY "Users manage own quality gate history"
ON quality_gate_history FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE quality_gate_history IS
  'Every Quality Gate issue found, logged per article. Used to detect recurring pipeline bugs vs one-off content issues.';
