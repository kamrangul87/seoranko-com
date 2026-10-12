-- Fix Agent failure ledger + circuit breaker for (topic, verdict) pause/resume.

CREATE TABLE IF NOT EXISTS public.fix_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NULL,
  run_id uuid NULL,
  finding_id uuid NULL,
  topic text NOT NULL,
  verdict text NOT NULL,
  stage text NOT NULL
    CHECK (stage IN (
      'resolve',
      'apply',
      'preview_verify',
      'production_verify',
      'revert',
      'stall'
    )),
  signature text NOT NULL,
  signature_hash text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fix_failures_signature_created_idx
  ON public.fix_failures (signature_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS fix_failures_topic_verdict_created_idx
  ON public.fix_failures (topic, verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS fix_failures_created_at_idx
  ON public.fix_failures (created_at DESC);
CREATE INDEX IF NOT EXISTS fix_failures_site_created_idx
  ON public.fix_failures (site_id, created_at DESC);

ALTER TABLE public.fix_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fix_failures FROM anon, authenticated;
GRANT ALL ON public.fix_failures TO service_role;

COMMENT ON TABLE public.fix_failures IS
  'Fix Agent failure ledger; service-role writes; master reads via admin API. Evidence must never include customer page body text.';

CREATE TABLE IF NOT EXISTS public.fix_type_status (
  topic text NOT NULL,
  verdict text NOT NULL,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'paused')),
  paused_reason text NULL,
  paused_at timestamptz NULL,
  failure_count_window integer NOT NULL DEFAULT 0,
  last_failure_at timestamptz NULL,
  resumed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic, verdict)
);

ALTER TABLE public.fix_type_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fix_type_status FROM anon, authenticated;
GRANT ALL ON public.fix_type_status TO service_role;

COMMENT ON TABLE public.fix_type_status IS
  'Circuit breaker for (topic, verdict) auto-fix types. Resume is master-only after e2e passes since pause.';
