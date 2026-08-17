-- Persist full RANKO diagnosis JSON + soft-delete for ROI articles

CREATE TABLE IF NOT EXISTS public.ranko_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  site_url TEXT NOT NULL,
  overall_health TEXT,
  health_score INTEGER,
  issue_count INTEGER,
  top_actions JSONB DEFAULT '[]'::jsonb,
  diagnosis JSONB,
  diagnosed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ranko_diagnoses
  ADD COLUMN IF NOT EXISTS diagnosis JSONB;

CREATE INDEX IF NOT EXISTS idx_ranko_diagnoses_user_site_time
  ON public.ranko_diagnoses (user_id, site_url, diagnosed_at DESC);

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_user_not_deleted
  ON public.articles (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.ranko_diagnoses.diagnosis IS
  'Full RANKODiagnosis JSON so the Diagnose tab can reload the last run';
COMMENT ON COLUMN public.articles.deleted_at IS
  'Soft-delete timestamp; NULL means active. Restore clears this.';
