# Fix-flow E2E status — autodun actionable four → two

Source: `FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md` (recrawl 2026-09-22T08:00:43Z).
Outcome ledger: `FIX_VERIFY_OUTCOME_RECORD.md`.
Production: `eafa461` Ready on `autodun.com`.

## Closed (fix → production verify → recrawl)

| Topic | Verdict | Page | PR | Status |
|-------|---------|------|----|--------|
| 49 | `auto-set-dimensions` | `/blog/mot-advisories-explained-uk.html` | [#34](https://github.com/kamrangul87/autodun-ai/pull/34) | Closed earlier |
| 49 | `human-review-no-height-auto` | `/blog/electric-car-charger-map-uk.html` | [#35](https://github.com/kamrangul87/autodun-ai/pull/35) | **Closed** — owner-approved agent merge |
| 49 | `finding-wrong-ratio` | `/blog/mot-changes-2026-dvsa-updates.html` | [#36](https://github.com/kamrangul87/autodun-ai/pull/36) | **Closed** — no object-fit; dims corrected |
| 8 | `human-review-preferred-conflict` | `/blog` | [#37](https://github.com/kamrangul87/autodun-ai/pull/37) | **Closed** — canonical `/blog` |
| 25 | `moderate-out-of-scope` | `mot.autodun.com` in sitemap | [#38](https://github.com/kamrangul87/autodun-ai/pull/38) | **Closed** — entry removed; mot has own sitemap |

Actionable **4 → 2**.

## Remaining actionable

| Topic | Verdict | Scope | Notes |
|-------|---------|-------|-------|
| 49 | `human-review-no-height-auto` | 5 URLs (rollup) · sample `/blog/ev-charging-on-uk-motorways.html` | Other pages still lack scoped `height:auto` |
| 49 | `finding-wrong-ratio` | `/blog/mot-cost-uk-2026.html` | Different page from #36 |

API rejects `approve`/`commit` for non-`auto-fixable` surface classes unless owner-approved human/agent path.
