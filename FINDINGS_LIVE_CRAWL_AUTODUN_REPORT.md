# Findings live crawl — autodun.com

Generated: 2026-09-21T07:24:13.554Z

## Caps

| Cap | Value | Why |
|-----|-------|-----|
| `CRAWL_URL_CHUNK_SIZE` | 5 | Per-tick URL budget under Hobby `maxDuration=60` (stream-complete + topic-68 re-fetch + detectors). Queue resumes via `/tick`. |
| `CRAWL_MAX_DISCOVERED` | 500 | Product safety: `startCrawlRun` discovers + enqueues in one invocation. Unbounded sitemaps would blow memory/time before the first tick. Hitting it → **partial**. |

## Run (genuine completion — no sample maxUrls)

| Metric | Value |
|--------|-------|
| Origin | https://autodun.com |
| Run id | e371f5ba-3d98-4071-aa64-4c498502d490 |
| Status | complete |
| Partial | false |
| Duration | 1.1s |
| URLs found (frontier) | 12 |
| URLs enqueued | 12 |
| URLs crawled | 12 |
| URL cap applied | none |
| Chunk size | 5 |

## Counts (live vs demo)

| Bucket | Live | Demo |
|--------|------|------|
| actionable | 12 | 10 |
| informational | 15 | 17 |
| internal (hidden) | 269 | 349 |

List API actionable rows: 12
List API with informational: 27

## Coverage notes

- **off_host**: Skipped 1 off-host sitemap loc(s)

## Actionable verdicts (live)

- topic 25 · `moderate-out-of-scope` · 1 URL(s) · https://autodun.com/sitemap.xml
- topic 38 · `human-review-entity-url-mismatch` · 11 URL(s) · generator:site-jsonld · https://autodun.com/blog
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s) · https://autodun.com/blog/electric-car-charger-map-uk.html
- topic 49 · `human-review-no-height-auto` · 6 URL(s) · generator:site-images · https://autodun.com/blog/electric-car-charger-map-uk.html
- topic 43 · `finding-link-graph-orphan` · 1 URL(s) · https://autodun.com/blog
- topic 49 · `auto-set-dimensions` · 1 URL(s) · generator:site-images · https://autodun.com/blog/mot-advisories-explained-uk.html
- topic 49 · `finding-wrong-ratio` · 2 URL(s) · generator:site-images · https://autodun.com/blog/mot-changes-2026-dvsa-updates.html
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s) · https://autodun.com/blog/mot-history-check-uk.html
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s) · https://autodun.com/blog/uk-vehicle-data-tools.html
- topic 43 · `finding-link-graph-orphan` · 1 URL(s) · https://autodun.com/blog/uk-vehicle-data-tools.html
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s) · https://autodun.com/blog/ulez-checker-uk.html
- topic 43 · `finding-link-graph-orphan` · 1 URL(s) · https://autodun.com/blog/ulez-checker-uk.html

## Demo actionable (for diff)

- topic 38 · `human-review-entity-url-mismatch` · 10 URL(s) · generator:autodun-blog-jsonld · https://autodun.com/blog
- topic 49 · `human-review-no-height-auto` · 5 URL(s) · generator:autodun-blog-images · https://autodun.com/blog
- topic 49 · `finding-wrong-ratio` · 2 URL(s) · generator:autodun-blog-images · https://autodun.com/blog/mot-cost-uk-2026.html
- topic 49 · `auto-set-dimensions` · 1 URL(s) · generator:autodun-blog-images · https://autodun.com/blog/ulez-checker-uk.html
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s) · https://autodun.com/blog
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s) · https://autodun.com/
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s) · https://autodun.com/blog
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s) · https://autodun.com/
- topic 25 · `moderate-out-of-scope` · 1 URL(s) · https://autodun.com/sitemap.xml
- topic 43 · `finding-orphan-in-sitemap-lower` · 1 URL(s) · https://autodun.com/blog

## Live vs demo actionable delta

Live count 12 vs demo 10.

### The two extras (live − demo)

Demo listed **one** topic-43 row: `finding-orphan-in-sitemap-lower` on `/blog`.
Live emitted **three** topic-43 rows with verdict `finding-link-graph-orphan`:

1. `/blog` — same orphan the demo had (different verdict label; live detector
   does not elevate to `finding-orphan-in-sitemap-lower` without the sitemap-
   listed-orphan classifier path the demo hand-authored).
2. `/blog/uk-vehicle-data-tools.html` — **extra** graph orphan the demo missed.
3. `/blog/ulez-checker-uk.html` — **extra** graph orphan the demo missed.

So the +2 actionable are **new findings** (additional orphan pages), not a
different rollup of the same rows. Shared topics (25, 34×2, 38, 39×2, 49×3)
align; counts on rolled rows differ slightly (38: 11 vs 10, 49 no-height: 6 vs 5)
because the live frontier includes one more page than the demo sample assumed.

Live keys:
- `25|moderate-out-of-scope|https://autodun.com/sitemap.xml|`
- `38|human-review-entity-url-mismatch|https://autodun.com/blog|generator:site-jsonld`
- `39|d17-faq-markup-not-visible|https://autodun.com/blog/electric-car-charger-map-uk.html|`
- `49|human-review-no-height-auto|https://autodun.com/blog/electric-car-charger-map-uk.html|generator:site-images`
- `43|finding-link-graph-orphan|https://autodun.com/blog|`
- `49|auto-set-dimensions|https://autodun.com/blog/mot-advisories-explained-uk.html|generator:site-images`
- `49|finding-wrong-ratio|https://autodun.com/blog/mot-changes-2026-dvsa-updates.html|generator:site-images`
- `34|low-lang-inlanguage-disagree|https://autodun.com/blog/mot-history-check-uk.html|`
- `34|low-lang-inlanguage-disagree|https://autodun.com/blog/uk-vehicle-data-tools.html|`
- `43|finding-link-graph-orphan|https://autodun.com/blog/uk-vehicle-data-tools.html|`
- `39|d17-faq-markup-not-visible|https://autodun.com/blog/ulez-checker-uk.html|`
- `43|finding-link-graph-orphan|https://autodun.com/blog/ulez-checker-uk.html|`

Demo keys:
- `38|human-review-entity-url-mismatch|https://autodun.com/blog|generator:autodun-blog-jsonld`
- `49|human-review-no-height-auto|https://autodun.com/blog|generator:autodun-blog-images`
- `49|finding-wrong-ratio|https://autodun.com/blog/mot-cost-uk-2026.html|generator:autodun-blog-images`
- `49|auto-set-dimensions|https://autodun.com/blog/ulez-checker-uk.html|generator:autodun-blog-images`
- `39|d17-faq-markup-not-visible|https://autodun.com/blog|`
- `39|d17-faq-markup-not-visible|https://autodun.com/|`
- `34|low-lang-inlanguage-disagree|https://autodun.com/blog|`
- `34|low-lang-inlanguage-disagree|https://autodun.com/|`
- `25|moderate-out-of-scope|https://autodun.com/sitemap.xml|`
- `43|finding-orphan-in-sitemap-lower|https://autodun.com/blog|`

## Notes

- Detectors unchanged; this path only crawls, calls them, rolls up, and persists.
- Re-run upserts by `(site, topic, rollup_key)` and records observation runs.
- Internal-bucket rows are stored as evidence and never returned by the findings list API.
- **complete** = frontier exhausted, queue empty, no coverage gaps.
- **partial** = discovery/maxUrls cap, or client_only / fetch failures after drain.
