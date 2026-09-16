# Shared facts — indexability directives block (topics 19–23)

Research date: 2026-09-15

## primary source

- RFC 9309, Robots Exclusion Protocol, September 2022 —
  https://www.rfc-editor.org/rfc/rfc9309.html
- Google, Robots meta tag, data-nosnippet, and X-Robots-Tag specifications —
  https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- Google, Block search indexing with noindex —
  https://developers.google.com/search/docs/crawling-indexing/block-indexing
- Google, Introduction to robots.txt —
  https://developers.google.com/search/docs/crawling-indexing/robots/intro

## Verified facts — page-level directives

| # | Fact | Status |
|---|---|---|
| R1 | `<meta name="robots">` and `X-Robots-Tag` are equivalent mechanisms | verified |
| R2 | `name="robots"` applies to all supporting crawlers; `name="googlebot"` targets Google | verified |
| R3 | Directive names and values are case-insensitive | verified |
| R4 | `X-Robots-Tag` supports every rule available via robots meta, and works for non-HTML resources | verified |
| R5 | Multiple rules may be separate tags/headers or comma-separated | verified |
| R6 | **Conflicting rules resolve to the more restrictive result** | verified |
| R7 | `none` means `noindex, nofollow` | verified |
| R8 | Standard placement is `<head>`; Google currently states it also respects robots meta in `<body>` | verified |
| R9 | `noindex` in `robots.txt` is **unsupported** (deprecated 2019) | verified |
| R10 | These are crawler directives, **not** part of RFC 9309 | verified |
| R11 | For `noindex` to be effective, the page must **not** be blocked by `robots.txt` | verified |

Note R8 against C2 in the canonical block: a canonical in `<body>` is
disregarded, but robots meta in `<body>` is currently respected. Different
rules — do not generalise one to the other.

## Verified facts — robots.txt (RFC 9309)

| # | Fact | Status |
|---|---|---|
| R12 | File is `/robots.txt`, lowercase, at the origin's top level | verified |
| R13 | UTF-8, served as `text/plain` | verified |
| R14 | User-agent matching is case-**insensitive** | verified |
| R15 | Path matching should be case-**sensitive** | verified |
| R16 | Most-specific / longest rule wins | verified |
| R17 | Equally specific `Allow` and `Disallow` → `Allow` wins | verified |
| R18 | No matching rule → access allowed | verified |
| R19 | Rules control crawler **access**, not indexing | verified |
| R20 | A 4xx robots.txt response permits crawling | verified |
| R21 | A 5xx or unreachable robots.txt requires assuming **complete disallow** initially | verified |
| R22 | Cached rules generally should not be used beyond 24 hours unless the file is unreachable | verified |
| R23 | robots.txt is **not** access control and must not protect sensitive information | verified |
| R24 | Googlebot processes up to 500 KiB; rules beyond that are ignored | verified |
| R25 | Google supports `*` wildcards and `$` end-of-line anchors | verified |
| R26 | Google ignores `crawl-delay` | verified |
| R27 | Google Search will not render JavaScript from blocked files or on blocked pages | verified |
| R28 | Google recommends blocking resources only where their absence does not significantly affect its understanding of the page | verified |

## Not adopted

- **"Layout penalties"** from blocked assets. Not a documented concept.
- **Any claim that blocking assets causes a ranking penalty.** R27 and R28
  describe understanding, not penalties.
