# Topics 2b, 3, 15, 38, 43, 45 — detect and report

Branch: `cursor/detect-report-2b-3-15-38-43-45-922c`
Date: 2026-09-17

## Built

Detect-and-report only (no fixers except topic 38 entity-`url` self-repoint,
which the dossier names explicitly). Shared crawlable link graph for 43/45.

| Topic | Module | Behaviour |
|---|---|---|
| 2b | `topic-2b` | Structural emptiness → **"potential soft 404"** observation. No phrase matching. Never "soft 404". |
| 3 | `topic-3` | Reproducibility: `stableAcrossRefetch` / transient / historical-GSC / timeout. `persistent-5xx` gated on unset product window. No repo fix. |
| 15 | `topic-15` | Topic 70 mandatory: repo-noindex → human-review; injected → topic 14; cascade source; topic 20 conflict. |
| 38 | `topic-38` | 38a structured↔structured only. 38b observation language (D23). Entity `url` auto-fix when should be self. |
| 43 | `topic-43` | Link-graph orphan only. onclick-only = orphan; JS-rendered `<a href>` = not. `client_only` reported honestly. |
| 45 | `topic-45` | Depth + shortest path metric. No severity. No Google threshold. Orphans → topic 43. |

## Tests assert

- 2b: potential soft 404 wording; repo-noindex / 5xx suppress; rejected helpers
- 3: stable pair; transient; Retry-After; timeout≠5xx; GSC historical with date; single obs suppress
- 15: repo contradiction; injected→14; cascade; header/meta→20; healthy suppress
- 38: date order; future; ratingCount 0; entity url auto; format-only suppress; value differ; paywall; 38b observation
- 43/45: orphan / sitemap-lower / onclick / JS-rendered suppress / homepage / noindex / campaign; depth+path; pagination; client_only both; no undiscoverability claim

## Constraints checked

1. No error-phrase text matching; "potential soft 404" only
2. 5xx = reproducibility; no repo fix; GSC historical with date
3. Topic 70 discriminator mandatory for 15; always human-review for repo-noindex
4. 38a structured only; 38b never spam-policy accusation
5. Orphan ≠ undiscoverable; JS-rendered `<a href>` not orphan
6. No depth threshold / severity; shortest path reported
7. `client_only` graph — no false orphans
