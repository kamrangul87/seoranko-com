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
4. DataForSEO is **no longer** used by Content Briefs (seed-only). Rank tracking / legacy Keywords station may still call it when credentials exist — metering for those paths can stay until they are retired or replaced.

## Until then
- Copilot Audit + Briefs endpoints do not increment `articles_used_month`
- Legacy Write / article-v2 / publish return HTTP 410

## Fix Agent (this pass) — billing implication only
- **Audit-only** (any pasted URL): free / included — report only, no write access
- **Fix Agent** (auto-apply on a connected/owned site): should be a **premium** gate in a later pass
  - Requires an active site connection (WP / Shopify / GitHub)
  - Rate-limited per site; every attempt logged + revertible
- Do **not** implement plan checks, Stripe meters, or paywalls in this PR — only the connection permission gate

## AI Visibility (citation check) — billing implication only
- Weekly OpenAI + Perplexity checks with configurable `AI_VISIBILITY_PROMPT_CAP`
- Per-run `cost_usd` is logged for unit economics — **not** billed in this pass
- Likely a premium add-on later; no pricing logic here
