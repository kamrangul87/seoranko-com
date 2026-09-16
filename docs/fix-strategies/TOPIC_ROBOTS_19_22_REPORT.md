# Topics 19–22 — noindex / meta-header / robots.txt

Branch: `cursor/robots-19-22-922c`
Date: 2026-09-16

## Built

Shared helpers:

- `robots-directives` — expand `none`→`noindex,nofollow`, case-insensitive
  tokens, meta + X-Robots-Tag extraction (R3/R5/R6/R7/R8)
- `robots-txt-inspect` — **one** parse/inspection for topics 22 and 21
  (`fetchAndInspectRobotsTxt` / `inspectRobotsTxtBody` /
  `isPathAllowedFromInspection`)
- `response-signals.hasNoindexDirective` now uses the shared expander

| Topic | Module | Key behaviour |
|---|---|---|
| 19 | `topic-19/detect` | Contradiction only (sitemap / self-canonical / canonical target). Injected → topic 2a via `repo-declared-noindex`. Never auto-remove noindex. |
| 20 | `topic-20/detect` | Conflict ≠ breakage. High surprise: HTML index + header noindex. robots vs googlebot = scopes, not conflict. Header scope indeterminate when multi-route. |
| 21 | `topic-21/detect` | Reuses topic-22 `RobotsTxtInspection`. All three conditions required. Report only; materiality never asserted. |
| 22 | `topic-22/*` | 404 normal (R20); 5xx = complete disallow (R21). Auto-fix only: text/plain + remove crawl-delay. Never edit Disallow; never create robots.txt. Verifier ≠ fixer. |

## Tests assert

- Topic 19: sitemap contradiction; injected→2a; absent sitemap suppress; layout cascade; generateMetadata indeterminate; `NONE` expands
- Topic 20: high/low surprise; identical + none≡noindex,nofollow informational; robots/googlebot suppress; multi-route indeterminate
- Topic 22: 5xx critical (re-fetch); 404 suppress; text/html auto; noindex human-review; crawl-delay auto; size/malformed human-review; valid ok; Disallow/create rejected
- Topic 21: only blocked.css reported; JS-on-noindex / Allow / cross-origin / analytics / Bingbot-only suppressed; 5xx inspection disallows; 404 permits

## Constraints checked

1. 404 robots.txt ≠ defect; 5xx ≠ 404
2. No Disallow auto-edit; no create-where-absent
3. Topic 19 = contradiction, never “should index” inference
4. Topic 20 conflict is defined (R6); surprise case is the finding
5. Topic 21 three conditions; no auto-unblock
6. `none` expansion + case-insensitive matching
