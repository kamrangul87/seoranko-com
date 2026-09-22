-- GitHub App credentials (product singleton) + installations.
-- Secrets live only in credentials_ciphertext (AES-GCM via site-connection-crypto).
-- Service-role writes; no browser SELECT of ciphertext.

CREATE TABLE IF NOT EXISTS public.github_app_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Enforces at most one product GitHub App registration.
  singleton boolean NOT NULL DEFAULT true CHECK (singleton) UNIQUE,
  app_id bigint NOT NULL UNIQUE,
  slug text NOT NULL,
  client_id text NOT NULL,
  -- Encrypted JSON: { private_key_pem, client_secret, webhook_secret }
  credentials_ciphertext text NOT NULL,
  html_url text,
  created_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.github_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id bigint NOT NULL UNIQUE,
  account_login text NOT NULL,
  account_type text NOT NULL DEFAULT 'User',
  account_id bigint,
  -- SEORANKO user who completed verified setup (nullable until verified)
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  repository_selection text,
  suspended_at timestamptz,
  uninstalled_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_installations_user_id_idx
  ON public.github_installations (user_id)
  WHERE uninstalled_at IS NULL;

ALTER TABLE public.github_app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon — service role only (bypasses RLS).

COMMENT ON TABLE public.github_app_config IS
  'SEORANKO product GitHub App credentials. Service-role only; ciphertext never exposed to clients.';
COMMENT ON COLUMN public.github_app_config.credentials_ciphertext IS
  'enc:v1 AES-GCM blob: private_key_pem, client_secret, webhook_secret';
COMMENT ON TABLE public.github_installations IS
  'GitHub App installations linked to SEORANKO users after verified setup.';
