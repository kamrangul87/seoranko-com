# SEORANKO Stripe billing setup

SEORANKO shares a Stripe account (minso ltd) with other products. All Checkout
sessions, customers, and subscriptions created by this app set
`metadata.app = seoranko` plus `seoranko_user_id` / `seoranko_plan_id`. The
webhook at `/api/webhooks/stripe` ignores events that are not SEORANKO.

## Environment variables

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `STRIPE_SECRET_KEY` | Yes | Stripe Dashboard → **Developers → API keys** (Test mode: `sk_test_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes (client / future Elements) | Same page (`pk_test_…`) |
| `STRIPE_PLACEHOLDER_PRICE_ID` | Yes (Checkout) | **Product catalog → Products** → create a Product + recurring Price → copy `price_…` |
| `STRIPE_WEBHOOK_SECRET` | Yes (webhook sync) | **Developers → Webhooks → Add endpoint** → signing secret `whsec_…` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (webhook writes) | Supabase project → **Settings → API → service_role** |
| `NEXT_PUBLIC_APP_URL` | Recommended | Your production origin (Checkout return URLs) |

Pricing is intentionally a single placeholder tier (`seoranko_starter`). When
real plans ship, update `STRIPE_PLACEHOLDER_PRICE_ID` (and later extend
`src/lib/stripe/plans.ts`) — Checkout/webhook code stays the same.

## Stripe Dashboard checklist

1. **Product + Price**  
   Create a test Product (e.g. “SEORANKO Starter”) with a recurring Price.  
   Set `STRIPE_PLACEHOLDER_PRICE_ID` to that Price ID.

2. **Webhook endpoint** (dedicated to SEORANKO — do not reuse for other products)  
   - URL: `https://<your-domain>/api/webhooks/stripe`  
   - Events (minimum):  
     - `checkout.session.completed`  
     - `customer.subscription.updated`  
     - `customer.subscription.deleted`  
     - `invoice.payment_failed`  
   - Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`.

3. **Customer Portal**  
   Dashboard → **Settings → Billing → Customer portal** → enable payment method
   update + cancel subscription (needed for “Manage billing”).

4. **Database**  
   Apply `supabase/migrations/20260905100000_subscriptions.sql` to the hosted
   project (RLS: owner SELECT only; no client writes).

## Local test flow

1. Set the env vars above (plus Supabase anon URL/key).  
2. Open `/dashboard/billing` → **Subscribe**.  
3. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.  
4. Confirm Stripe Dashboard shows the Checkout + subscription.  
5. Confirm a `subscriptions` row appears (`status = active`) after the webhook.  
6. Click **Manage billing** → Stripe Customer Portal should open.

Local webhook forwarding (optional):  
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`  
and use the CLI’s `whsec_…` as `STRIPE_WEBHOOK_SECRET`.
