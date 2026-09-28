# SEORANKO — Implementation record (autodun dogfood)

Short ledger of what shipped and what the dogfood numbers actually mean.
Companion to `docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md`.

## Autodun-ai production fixes (keep)

Eleven customer-repo fixes were applied under explicit owner approval, each as
its own PR, with CI + preview verify + production verify:

| # | Topic / kind | autodun-ai PR | Production |
|---|--------------|---------------|------------|
| Topic 49 dims / height:auto / ratio | multiple pages | #34–#44 | Verified on live HTML |
| Topic 1 about → charging-map href | broken internal link | #46 | Live CTA → `https://ev.autodun.com/` |
| Topic 27 sitemap /about | report-omission | #47 | Live sitemap lists about |
| Topic 27 sitemap /contact | report-omission | #48 | Live sitemap lists contact |
| Topic 34 mot-predictor lang | FP — no site change | seoranko guard | Cross-host redirect suppress |

These fixes are real. Production tip Ready was confirmed for the tip that
includes them.

## What “5 → 4 → 0 actionable” did **not** mean

Earlier notes described autodun going 5 → 4 → 0 actionable as if findings were
**resolved** by the product’s resolution lifecycle.

That was wrong:

- Crawl runs for autodun stayed `status='running'` with `finished_at=null`
  (orphaned `running` URL jobs after killed ticks; no abandon timeout).
- Resolution only ran on a finished `complete` run — so **no resolution
  event ever fired**.
- Actionable-count drops were **stale / differently-scoped crawl list
  snapshots**, not `status=resolved` transitions.

Correct framing: production postconditions for the fixed pages hold; finding
rows were not closed via resolution until crawl completion + scoped
resolution shipped.

## Crawl completion (required for real resolution)

Fixed in product:

1. Reclaim orphaned `running` jobs at tick start so frontier drain can finish.
2. Terminal `complete` / `partial` with `finished_at` when the queue drains.
3. Abandoned runs (`queued`/`running` with no tick for 30+ minutes) → `failed`.
4. Resolution on `complete` **and** `partial`, only for URLs that run assessed.

## Change Monitoring

- **Stage 1 (§3.1)** — URL observation timeline (persist + classify). See
  `docs/fix-strategies/CHANGE_MONITORING_STAGE_1.md`.
- Stages 2–4 not started.
