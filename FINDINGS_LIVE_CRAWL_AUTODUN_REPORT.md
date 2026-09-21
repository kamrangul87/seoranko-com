# Findings live crawl — autodun.com

Generated: 2026-09-21T07:56:29.856Z

## 1. Discovery

Seeds from **robots.txt Sitemap: records**, **sitemap.xml locs**, the
**homepage**, and **crawlable `<a href>` expansion** during ticks (same-host
only). The previous "12" frontier was sitemap-only; the consolidation audit's
"16 nodes" was a homepage link-graph extract — not the same population.

| Seed source | Count |
|-------------|-------|
| robots Sitemap locs | 12 |
| sitemap.xml fallback | 0 |
| homepage | 1 |
| link-graph expand | 2 |
| **URLs found (frontier)** | **14** |
| URLs crawled | 13 |
| client_only pages | 1 |

Caps: `CRAWL_URL_CHUNK_SIZE=5` (tick budget);
`CRAWL_MAX_DISCOVERED=500` (start-handler safety).

## 2. Whole-site detector audit

Detectors that need the full crawl set run **once when the frontier is
exhausted** (post-crawl), not per chunk — same fix class as topic 43.

| Topic | Need | Prior wiring | Now |
|-------|------|--------------|-----|
| 27 | crawled set vs sitemap set | once on **first chunk** (incomplete pages) | post-crawl |
| 33 | duplicate titles/descriptions across URLs | shipped, unwired | post-crawl |
| 45 | shortest path from homepage | shipped, unwired | post-crawl |
| 46 | hreflang reciprocity (both pages of a pair) | shipped, unwired | post-crawl |
| 8–12 | both URL variants | unwired; probe peer via live fetch → **PER-PAGE** when wired | scoped per-page |
| 58 | index vs crawl set divergence | unshipped | reserved `whole-site` (whole-site) |
| 43 | orphan link graph | post-crawl (already) | post-crawl |

Post-crawl emit summary:
- topic 24 (whole-site): 1 emit(s), 0 actionable
- topic 25 (whole-site): 1 emit(s), 1 actionable
- topic 27 (whole-site): 13 emit(s), 1 actionable
- topic 28 (whole-site): 1 emit(s), 0 actionable
- topic 33 (whole-site): 2 emit(s), 0 actionable
- topic 43 (whole-site): 1 emit(s), 0 actionable
- topic 45 (whole-site): 15 emit(s), 0 actionable
- topic 46 (whole-site): 0 emit(s), 0 actionable

Every shipped detector declares `DETECTOR_SCOPE` (`per-page` | `whole-site`);
the chunk loop asserts PER-PAGE only.

## 3. Topic 43 orphans vs client_only

Homepage served HTML has **0 `<a href>`** (SPA shell + JS bundle) → marked
`client_only`. `/blog/uk-vehicle-data-tools.html` and
`/blog/ulez-checker-uk.html` **are linked from `/blog` in served HTML**, but
because any crawled page is client_only, topic 43 **cannot** conclude
orphan-hood from served HTML alone (nav may also exist only after render on
the homepage).

Guard: `hasClientOnlyPages` → verdict `client_only-limited` (informational),
**not** `finding-link-graph-orphan`.

Topic 43 emits: client_only-limited
Orphan findings raised: 0

## Run

| Metric | Value |
|--------|-------|
| Status | partial |
| Partial | true |
| Duration | 1.1s |

## Counts (vs prior corrected actionable=9)

| Bucket | Live | Prior corrected | Demo |
|--------|------|-----------------|------|
| actionable | 10 | 9 | 10 |
| informational | 16 | 16 | 17 |
| internal (hidden) | 315 | 290 | 349 |

Actionable changed from 9: **yes (10)**

List API actionable: 10
List API + informational: 26

### Actionable verdicts

- topic 38 · `human-review-entity-url-mismatch` · 13 URL(s) · https://autodun.com/blog
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s) · https://autodun.com/blog/electric-car-charger-map-uk.html
- topic 49 · `human-review-no-height-auto` · 6 URL(s) · https://autodun.com/blog/electric-car-charger-map-uk.html
- topic 49 · `auto-set-dimensions` · 1 URL(s) · https://autodun.com/blog/mot-advisories-explained-uk.html
- topic 49 · `finding-wrong-ratio` · 2 URL(s) · https://autodun.com/blog/mot-changes-2026-dvsa-updates.html
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s) · https://autodun.com/blog/mot-history-check-uk.html
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s) · https://autodun.com/blog/uk-vehicle-data-tools.html
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s) · https://autodun.com/blog/ulez-checker-uk.html
- topic 25 · `moderate-out-of-scope` · 1 URL(s) · https://autodun.com/sitemap.xml
- topic 27 · `report-omission` · 1 URL(s) · https://autodun.com/blog/index.html

Coverage notes:
- **off_host**: Skipped 1 off-host sitemap loc(s)
- **link_graph_expand**: Seed discovery: robots Sitemap locs=12, sitemap fallback=0, homepage=1; link-graph expansion during ticks
- **client_only**: Served HTML looks client_only — content detectors skipped; outbound links may appear only after rendering (topic 67)
- **link_graph_expand**: Enqueued 1 same-host URL(s) from crawlable links on https://autodun.com/blog
- **link_graph_expand**: Enqueued 1 same-host URL(s) from crawlable links on https://autodun.com/blog/electric-car-charger-map-uk.html
