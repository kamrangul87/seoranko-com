# Topics 8–12 — duplicate URL forms report

Branch: `cursor/duplicate-url-8-12-922c`
Date: 2026-09-16

## Checks on merged canonical work (topics 13–17)

1. **Body-placement → topic 29 cause:** Previously only reported
   `finding-body-misplaced`. Now reports **both**: the canonical is absent
   (C2) **and** `causeTopic: 29` / `routedCauses` explaining the structural
   cause (non-metadata / tags outside `<head>`). Fixture uses premature
   `<div>` before the canonical so the parser places it in `<body>`.

2. **Body robots meta (R8):** `hasNoindexDirective` already checked
   `bodyElements('meta')`. Added regression: after premature head close,
   body robots **is** detected while body canonical is **not** treated as an
   HTML canonical (`extractHtmlCanonical` → null). C2 applies to canonicals
   only.

## Built — topics 8–12

**ONE variant generator** (`shared/duplicate-url-variants.ts`) with five
strategies — not five detectors. One detector in `duplicate-url/detect.ts`;
topics 8–12 are thin strategy entrypoints.

| Topic | Strategy | Preferred form |
|---|---|---|
| 8 | trailing-slash | Site signals only; **site root excluded** |
| 9 | http-https | **HTTPS** (only documented preference) |
| 10 | www-non-www | Site signals; human-review / often outside repo |
| 11 | path-case | Site signals; **never blanket-lowercase** |
| 12 | query-params | Clean URL; **12a** tracking allow-list + identical content → prefer **canonical** over redirect; **12b** report-only |

Supporting: `content-sameness` (proven hash), `preferred-form` (no defaults),
tracking allow-list in `product-decisions.ts`.

## Constraints honored

1. Content sameness proven (body hash or normalised main-content hash).
2. Topic 8 site root never raised.
3. Topic 9 only uses Google’s HTTPS preference; 8/10/11 derive or human-review.
4. Topic 11 only specific proven pairs; blanket lowercase rejected.
5. Topic 12a prefer canonical; robots.txt param blocking throws REJECTED.
6. `url-normalize` does not collapse slash / case / query / port.

## Tests

Fixture sets for dossiers 8–12 + variant generator unit tests + topic 13
cause/R8 regressions. Fix-strategies suite green.
