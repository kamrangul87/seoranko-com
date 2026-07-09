-- Phase 1b: Add internal_links column to articles table
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS internal_links JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN articles.internal_links IS 'User-provided internal links injected into article generation';
