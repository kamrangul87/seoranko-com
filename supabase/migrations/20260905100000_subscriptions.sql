-- SEORANKO Stripe subscriptions (source of truth sync from Stripe webhooks).
-- Shared Stripe account with other products: rows are SEORANKO-only; webhook
-- filters by metadata.app = 'seoranko' before writing here.
--
-- RLS: owner SELECT only. No INSERT/UPDATE/DELETE for authenticated —
-- only the webhook (service role) may write.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL,
  plan_id text NOT NULL DEFAULT 'seoranko_starter',
  status text NOT NULL,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key
  ON public.subscriptions (user_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON public.subscriptions (stripe_customer_id);

COMMENT ON TABLE public.subscriptions IS
  'SEORANKO billing state mirrored from Stripe. Client read-only; webhook writes via service role.';

COMMENT ON COLUMN public.subscriptions.plan_id IS
  'Config key (e.g. seoranko_starter). Swap Stripe Price via STRIPE_PLACEHOLDER_PRICE_ID — not a code change.';

COMMENT ON COLUMN public.subscriptions.status IS
  'Mirrors Stripe subscription.status (active, trialing, past_due, canceled, unpaid, incomplete, …).';

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own subscriptions" ON public.subscriptions;
CREATE POLICY "Users read own subscriptions"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Intentionally no INSERT / UPDATE / DELETE policies for authenticated or anon.
-- Service role bypasses RLS for webhook upserts.
