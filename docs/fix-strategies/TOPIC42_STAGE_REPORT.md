# Topic 42 Stage 4 report — internal links pointing at redirects

Date: 2026-09-16
Branch: `cursor/topic42-redirect-links-922c`

## Built

`src/lib/fix-strategies/topic-42/`

- `detect.ts` — multi-page detector; shared-nav hrefs collapse to one finding
- `classify-redirect.ts` — severity by hop count; five-condition auto-rewrite gate;
  locale heuristic; routes to topics 1 / 4 / 5
- `resolve-declaration.ts` — topic 70 style repo scan for layout/nav/header/footer
- `fix-rewrite-href.ts` — fixture-only HTML href rewrite (no verifier import)
- `verify-live-href.ts` — live HTML + zero-redirect 200 postcondition (no fixer import)

Shared extensions:

- `preserveQueryAndFragment` / `wouldDropQueryOrFragment` on
  `shared/url-normalize.ts` (condition 5)
- `extractHtmlCanonical` / `isSelfCanonical` moved to
  `shared/response-signals.ts` (topic 26 re-exports)

## Five conditions (all required for `auto-rewrite`)

1. destination internal
2. every hop is 301/308
3. final 200, no noindex, self-canonical
4. no loop / ≤10 hops / topic-68 stable
5. query + fragment preserved via `preserveQueryAndFragment`

Shared-nav, 302/307, and locale/conditional redirects → `human-review` even
when 1–5 hold.

## Tests assert

Fixture `__fixtures__/topic-42-redirects/`:

| Case | Assert |
|---|---|
| single 301 → 200 | `auto-rewrite`, severity `low` |
| 3-hop chain | severity `moderate`, `auto-rewrite` |
| 5-hop chain | severity `high`, `auto-rewrite` |
| 302 | `human-review-temporary-redirect` |
| `/products` → `/en/products` | `human-review-conditional-redirect` |
| `/old?utm_source=x#section` | rewrite is `/new?utm_source=x#section` |
| nav link on 20 pages | **one** finding, `human-review-shared-nav`, names component |
| redirect → 404 | `route-topic-1-non-200` |
| live postcondition | rewritten href present; target 200 in zero redirects |
| verifier/fixer separation | verify source has no fixer import |

## Dossier notes (wrong / underspecified)

1. **CI asserts "moderate for the second; high for the third"** without saying
   those are still auto-fixable when all five conditions hold. Implemented as
   severity labels on `auto-rewrite` findings (not a separate verdict).
2. **"conditional redirects (auth, locale, device, geo, A/B)"** — only locale
   path-prefix swap is detectable statically from the Location hop. Auth /
   device / geo / A/B need request-variance evidence not available on a single
   fetch; left as future extension. Locale covered in fixture.
3. **`normalizeFixStrategyUrl` strips fragments by design** (comparison).
   Condition 5 required extending the shared helper with
   `preserveQueryAndFragment` rather than a local copy.
4. **Declaration site via topic 70** — site-model has no dedicated "find
   component declaring href" API; topic 42 adds `resolveHrefDeclaration` that
   walks app/components trees using the same roots topic 70 cares about.
