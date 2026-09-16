# Topics 4–7 — redirect chains / loops / 302 / target-not-200

Branch: `cursor/redirect-4-7-922c`
Date: 2026-09-16

## Built

**ONE chain walk** — `walkRedirectChain` → `ChainWalkResult`. Topics 4, 5, 6,
and 7 all classify from that object; the chain is never walked four times.

Shared hop recorder (`hop-recording-fetch`) extended:

- Visited-set membership uses `normalizeFixStrategyUrl` (not consecutive hops)
- Does **not** collapse slash / path case / query / port
- New stop reason: `missing-location` (3xx with no Location — own finding)

| Topic | Classifier | Key behaviour |
|---|---|---|
| 4 | `classify-topic-4` | Hop bands: 2–3 moderate, 4–10 high, >10 hard failure; severity ⊥ auto-fix |
| 5 | `classify-topic-5` | Loops via visited set; self-redirect; missing Location; slash bounce ≠ loop |
| 6 | `classify-topic-6` | Permanence evidence required; always human-review; never infer from status |
| 7 | `classify-topic-7` | Terminal via 68/3/2a/70; homepage repoint **rejected** |

## Tests assert

- Topic 4: 3-hop moderate + auto when static; 4-hop high; 11-hop hard failure; 1-hop ok; 404→topic 7; middleware indeterminate
- Topic 5: self / A→B→A / 3-cycle loops; 11-hop→topic 4; missing Location; `/page`→`/page/` not a loop
- Topic 6: permanence evidence → human-review; origin exists → suppress; middleware indeterminate; 301 → ok
- Topic 7: confirmed 4xx; declared noindex suppress; injected soft-404; transient 5xx→topic 3; temp→review; healthy ok
- One walk = 3 fetches for a 2-redirect chain (not 12)
