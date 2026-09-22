# Findings live crawl — autodun.com

Generated: 2026-09-22T09:03:44.631Z

## 1. Discovery

| Seed source | Count |
|-------------|-------|
| robots Sitemap locs | 12 |
| sitemap.xml fallback | 0 |
| homepage | 1 |
| link-graph expand | 0 |
| **URLs found (frontier)** | **12** |
| URLs crawled | 11 |
| client_only pages | 1 |

Caps: `CRAWL_URL_CHUNK_SIZE=5`;
`CRAWL_MAX_DISCOVERED=500`.

## 2. /blog/index.html vs /blog (topic 27)

Live check: identical body hash + same ETag → duplicate URL form, not a
sitemap omission. Sitemap correctly lists `/blog`.

Topic 27 guard: `classifySitemapDuplicateVariant` → `index-html` →
`route-topic-8-12-url-variants` (internal), not `report-omission`.

- report-omission for /blog/index.html: **0** (must be 0)
- routed index.html variant emits: 0

## 3. Topic 8 rollup + discoverability + auto-redirect

| Cause | Emit count | Notes |
|-------|------------|-------|
| informational-generated-only | 12 | peer not in crawl/sitemap/links |
| human-review-blast-radius | 0 | site-wide trailingSlash/cleanUrls |
| human-review-preferred-absent | 0 | no site preferred-form signals |
| auto-redirect | 0 | must be 0 (site-wide → human-review) |

List actionable topic 8 (after rollup to resolved routing config):
_None_

## 4. Topic 26 + cross-topic root cause

`/blog` HTML canonical → `https://autodun.com/blog/index.html` (index.html
variant of the sitemap loc). Topic 26 `human-review-canonical-elsewhere` and
topic 8 `human-review-preferred-conflict` share one preferred-form decision —
topic 8 is primary; topic 26 is related evidence, not a separate actionable row.

Linked preferred-form primaries (topic 8 with related topic 26): 0
_None_

List-API actionable topic 26 (must be 0 when linked): 0
_None_

## 4b. Topic 49 — per-page (declaration site = page URL)

Hand-authored blog HTML: each page is its own declaration site. Must NOT
collapse across pages via a fake `generator:site-images`.

_None_

## 5. Detector wiring (shipped-but-unwired = 0)

Wired count: 43 / shipped 43.
Unshipped reserved: topic 58 = whole-site.

| Topic | DETECTOR_SCOPE | Crawl call |
|-------|----------------|------------|
| 1 | per-page | chunk |
| 2b | per-page | chunk |
| 3 | per-page | chunk |
| 4 | per-page | chunk |
| 5 | per-page | chunk |
| 6 | per-page | chunk |
| 7 | per-page | chunk |
| 8 | whole-site | post-crawl |
| 9 | per-page | chunk |
| 10 | per-page | chunk |
| 11 | per-page | chunk |
| 12 | per-page | chunk |
| 13 | per-page | chunk |
| 14 | per-page | chunk |
| 15 | whole-site | post-crawl |
| 16 | per-page | chunk |
| 17 | per-page | chunk |
| 19 | whole-site | post-crawl |
| 20 | per-page | chunk |
| 21 | whole-site | post-crawl |
| 22 | whole-site | post-crawl |
| 24 | whole-site | post-crawl |
| 25 | whole-site | post-crawl |
| 26 | whole-site | post-crawl |
| 27 | whole-site | post-crawl |
| 28 | whole-site | post-crawl |
| 29 | per-page | chunk |
| 30 | per-page | chunk |
| 31 | per-page | chunk |
| 33 | whole-site | post-crawl |
| 34 | per-page | chunk |
| 35 | per-page | chunk |
| 36 | per-page | chunk |
| 37 | per-page | chunk |
| 38 | per-page | chunk |
| 39 | per-page | chunk |
| 42 | per-page | chunk |
| 43 | whole-site | post-crawl |
| 45 | whole-site | post-crawl |
| 46 | whole-site | post-crawl |
| 47 | whole-site | post-crawl |
| 48 | whole-site | post-crawl |
| 49 | per-page | chunk |

Post-crawl emit summary:
- topic 8 (whole-site): 22 emit(s), 0 actionable
- topic 15 (whole-site): 11 emit(s), 0 actionable
- topic 19 (whole-site): 11 emit(s), 0 actionable
- topic 21 (whole-site): 1 emit(s), 0 actionable
- topic 22 (whole-site): 0 emit(s), 0 actionable
- topic 24 (whole-site): 1 emit(s), 0 actionable
- topic 25 (whole-site): 1 emit(s), 0 actionable
- topic 26 (whole-site): 12 emit(s), 0 actionable
- topic 27 (whole-site): 11 emit(s), 0 actionable
- topic 28 (whole-site): 1 emit(s), 0 actionable
- topic 33 (whole-site): 0 emit(s), 0 actionable
- topic 43 (whole-site): 1 emit(s), 0 actionable
- topic 45 (whole-site): 13 emit(s), 0 actionable
- topic 46 (whole-site): 0 emit(s), 0 actionable
- topic 47 (whole-site): 1 emit(s), 0 actionable
- topic 48 (whole-site): 0 emit(s), 0 actionable

## 6. Topic 43

Topic 43 emits: client_only-limited
Orphan findings raised: 0

## Run

| Metric | Value |
|--------|-------|
| Status | partial |
| Partial | true |
| Duration | 4.6s |

## Counts

| Bucket | Live | Prior (wired 8–12) | Demo |
|--------|------|--------------------|------|
| actionable | 0 | 25 | 10 |
| informational | 17 | 16 | 17 |
| internal (hidden) | 882 | — | 349 |

List API actionable: 0
List API + informational: 17

### Actionable verdicts

_None_

Coverage notes:
- **link_graph_expand**: Seed discovery: robots Sitemap locs=12, sitemap fallback=0, homepage=1; link-graph expansion during ticks
- **client_only**: Served HTML looks client_only — content detectors skipped; outbound links may appear only after rendering (topic 67)
