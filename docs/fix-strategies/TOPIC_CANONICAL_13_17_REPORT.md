# Topics 13 / 14 / 16 / 17 — canonical block report

Branch: `cursor/canonical-13-17-922c`
Date: 2026-09-16

## Built

**One shared extractor** — `shared/canonical-extraction.ts`

- `extractCanonicalDeclarations(body, headers, pageUrl, contentType)`
- Head `link[rel=canonical]` via `html-parser` (implicit `</head>` / C2)
- Body misplaced links (count as absent for topic 13; own defect for 17)
- HTTP `Link` header `rel=canonical`
- Normalisation via `normalizeFixStrategyUrl` (no slash/case/query/port collapse)
- `extractHtmlCanonical` in `response-signals` is a thin wrapper — not a second extractor

**Supporting helpers**

- `shared/header-canonical-scope.ts` — topic 70 scope for Link header rules
- `shared/canonical-declaration-sites.ts` — page / layout / generateMetadata sites
- `hasNoindexDirective` also checks body robots meta (R8; not generalised from C2)

**Topics**

| Topic | Module | Key behaviour |
|---|---|---|
| 13 | `topic-13/` | Absence only when duplicates proven (8–12). Body-only = absent + misplaced. Never layout-level. |
| 14 | `topic-14/` | Target non-200 / chain / soft-404; transient 5xx → topic 3; self-canonical auto when page 200 |
| 16 | `topic-16/` | HTML vs header disagree; scope via topic 70 before removal; C12 scoped |
| 17 | `topic-17/` | Count all decls, normalised; identical → auto-collapse; differing → human-review; never first-by-order; C12 scoped |

## Tests assert

- Topic 13: duplicates+absent → finding; no duplicates → informational; body-only → misplaced; header present → suppress; generateMetadata → indeterminate; no site-wide absence findings; layout → human-review
- Topic 14: 404 → auto-self; transient 5xx → topic 3; 301 → chain; soft-404 → finding; healthy + PDF → ok
- Topic 16: conflict + multi-route → indeterminate; identical → informational; PDF header-only → suppress; dead target → topic 14; single-route + preferred HTML → auto-remove-header; scoped C12 note
- Topic 17: conflicting → human-review (no collapseTo); redundant → auto; body → auto-remove; page+layout sites → multi-site; one correct → ok; header+one HTML → topic 16
- Shared extractor: body-content before `</head>` places canonical in body

## Dossier notes

- C12 wording kept scoped ("likely", outdated-content warning) in topic 16/17 findings
- Topic 13 does not derive preferred form — requires topics 8–12 inputs
- Topic 16 never removes a multi-route / indeterminate header rule automatically
