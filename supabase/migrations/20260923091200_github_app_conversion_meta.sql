-- Persist GitHub App manifest conversion provenance (owner + field inventory).
-- Secrets remain only in credentials_ciphertext.

ALTER TABLE public.github_app_config
  ADD COLUMN IF NOT EXISTS owner_login text,
  ADD COLUMN IF NOT EXISTS owner_type text,
  ADD COLUMN IF NOT EXISTS owner_id bigint,
  ADD COLUMN IF NOT EXISTS conversion_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_field_names text[],
  ADD COLUMN IF NOT EXISTS conversion_response_meta jsonb;

COMMENT ON COLUMN public.github_app_config.owner_login IS
  'GitHub App owner login from manifest conversion (User or Organization).';
COMMENT ON COLUMN public.github_app_config.owner_type IS
  'GitHub App owner type from conversion (User | Organization).';
COMMENT ON COLUMN public.github_app_config.conversion_at IS
  'UTC timestamp when manifest code was exchanged and GET /app verified.';
COMMENT ON COLUMN public.github_app_config.conversion_field_names IS
  'Top-level keys present on the conversion response (secrets never stored here).';
COMMENT ON COLUMN public.github_app_config.conversion_response_meta IS
  'Non-secret subset of conversion + GET /app verify payload for forensics.';
