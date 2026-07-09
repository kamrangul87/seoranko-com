-- Phase 1c: add image URL columns and improve history log
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS image_hero TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_content1 TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_content2 TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_content3 TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS improve_history JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN articles.improve_history IS 'Log of improve actions: [{target, score_before, changes, improved_at}]';
