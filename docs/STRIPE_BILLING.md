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
| `STRIPE_STARTER_PRICE_ID` | Yes (Checkout, Starter £29/mo) | **Product catalog → Products** → create a Product + recurring Price → copy `price_…` |
| `STRIPE_PRO_PRICE_ID` | Yes (Checkout, Pro £79/mo) | Same, second Product/Price |
| `STRIPE_AGENCY_PRICE_ID` | Yes (Checkout, Agency £149/mo) | Same, third Product/Price |
| `STRIPE_WEBHOOK_SECRET` | Yes (webhook sync) | **Developers → Webhooks → Add endpoint** → signing secret `whsec_…` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (webhook writes) | Supabase project → **Settings → API → service_role** |
| `NEXT_PUBLIC_APP_URL` | Recommended | Your production origin (Checkout return URLs) |

Three real tiers (`seoranko_starter` / `seoranko_pro` / `seoranko_agency`),
content and price display defined in `src/lib/stripe/plans.ts` — the single
source of truth read by signup, the homepage pricing section, and the
billing page. Adding/renaming a tier or changing its price/copy is a change
to that one file; Checkout/webhook code stays the same, and the display
price (`priceDisplay`) is copy only — the amount actually charged is whatever
each Stripe Price is set to, so keep them in sync by hand.

**Important — tiers are not yet functionally different.** `entitlements.ts`
only checks "subscribed" vs "free", not which of the three tiers. The one
real per-tier lever already wired: `crawl_pages_per_run` (or
`seoranko_crawl_pages`) Price/Product metadata (see below) — set it to a
different number on each of the three Prices if you want Starter/Pro/Agency
to actually enforce different crawl sizes. Until then, all three unlock the
same allowance.

**Entitlements (1.6):** Detect-only audits stay free. `commit` on findings
fix-flow requires an active/trialing/past_due `subscriptions` row (or
`MASTER_EMAIL`). Crawl starts: free 5/UTC day, subscribed 50/UTC day.
Per-crawl pages: free **25**; paid from Stripe Price/Product metadata
`seoranko_crawl_pages` (fallback `crawl_pages_per_run`), default **500**.
Hitting the page cap → status `partial` with a plan-named note — see
`src/lib/stripe/entitlements.ts` and `product-decisions.ts`.

## Stripe Dashboard checklist

1. **Product + Price** (×3)  
   Create three test Products — “SEORANKO Starter” (£29/mo), “SEORANKO Pro”
   (£79/mo), “SEORANKO Agency” (£149/mo) — each with one recurring Price.  
   Set `STRIPE_STARTER_PRICE_ID` / `STRIPE_PRO_PRICE_ID` / `STRIPE_AGENCY_PRICE_ID`
   to the matching Price IDs.

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
