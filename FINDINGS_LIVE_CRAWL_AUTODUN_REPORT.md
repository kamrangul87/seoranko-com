# Findings live crawl — autodun.com

Generated: 2026-09-21T07:04:08.904Z

## Chunk size

- **CRAWL_URL_CHUNK_SIZE = 5**
- Why: each URL does stream-complete fetch (topic 67) + topic-68 confirming
  re-fetch + multi-detector work (including image header probes). Five URLs
  fit a ~45s tick under Vercel Hobby `maxDuration=60` with backoff headroom;
  remaining URLs resume on the next `/tick`.

## Run

| Metric | Value |
|--------|-------|
| Origin | https://autodun.com |
| Run id | e2e6a491-68ba-4a55-a97f-352850c6dc0c |
| Status | complete |
| Partial | false |
| Duration | 1.3s |
| URLs discovered (capped) | 12 |
| URLs crawled | 12 |
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

- topic 25 · `moderate-out-of-scope` · 1 URL(s)
- topic 38 · `human-review-entity-url-mismatch` · 11 URL(s) · generator:site-jsonld
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s)
- topic 49 · `human-review-no-height-auto` · 6 URL(s) · generator:site-images
- topic 43 · `finding-link-graph-orphan` · 1 URL(s)
- topic 49 · `auto-set-dimensions` · 1 URL(s) · generator:site-images
- topic 49 · `finding-wrong-ratio` · 2 URL(s) · generator:site-images
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s)
- topic 34 · `low-lang-inlanguage-disagree` · 1 URL(s)
- topic 43 · `finding-link-graph-orphan` · 1 URL(s)
- topic 39 · `d17-faq-markup-not-visible` · 1 URL(s)
- topic 43 · `finding-link-graph-orphan` · 1 URL(s)

## Notes

- Detectors unchanged; this path only crawls, calls them, rolls up, and persists.
- Re-run upserts by `(site, topic, rollup_key)` and records observation runs.
- Internal-bucket rows are stored as evidence and never returned by the findings list API.
- This verification used `maxUrls=12` (near the demo's 11-page sample). A product
  crawl uses discovery up to `CRAWL_MAX_DISCOVERED` (100) and marks discovery caps
  as partial coverage.
