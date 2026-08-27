# Billing / pricing — pivot flags (do not change in this pass)

SEORANKO is pivoting from AI article generation → SEO copilot (Site Audit + Keyword Briefs).
Billing must be revisited in a follow-up; **this PR does not change Stripe/plans/limits**.

## What still references article generation quotas
- `DashboardNav` / `user_profiles`: `articles_used_month` and plan `articles` caps (`free: 1`, `starter: 30`, …)
- Keyword plan limits remain relevant and should stay

## Recommended follow-up (not done here)
1. Rename or replace `articles_used_month` with `audits_used_month` + `briefs_used_month`
2. Reprice plans around **audit scans / month** and **briefs / month** instead of articles
3. Update marketing/pricing pages and Stripe product metadata when ready
4. Keep DataForSEO keyword usage metering as-is (still the backbone of Briefs)

## Until then
- Copilot Audit + Briefs endpoints do not increment `articles_used_month`
- Legacy Write / article-v2 / publish return HTTP 410
