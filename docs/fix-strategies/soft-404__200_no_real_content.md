# soft-404__200_no_real_content

Status: READY — 2a implementable, 2b report-only
Topic: 2 of the issue register
Tier: A (2a) / C (2b)
Depends on: topic 68 (re-fetch rule), topic 70 (site model)
Research dates: 2026-09-14

---

## what's actually wrong

A URL returns HTTP 200 but the resource does not exist. The status code says
success; the response is an error page.

## primary source

- Google Search Central, Soft 404 errors —
  https://developers.google.com/search/docs/crawling-indexing/http-network-errors
- Next.js, `not-found.js` file convention —
  https://nextjs.org/docs/app/api-reference/file-conventions/not-found

### Verified facts

| Fact | Status |
|---|---|
| Google classifies a URL as a soft 404 when it returns 200 but the page is effectively missing, empty, or shows an error message | verified |
| Google renders JavaScript before assessing, so the initial HTML is not the whole picture | verified |
| Google does not publish the complete classifier, the signals it weighs, or any threshold | verified (absence) |
| Next.js returns 200 for streamed responses; a `notFound()` firing mid-stream yields 200 with `noindex` injected | verified (topic 1) |
| Next.js docs state some crawlers label these responses as soft 404s | verified (topic 1) |

**Not adopted:** claims that soft 404s waste crawl budget or harm rankings.
No source, and outside what this product claims.

## the split

SEORANKO cannot reproduce Google's classifier and must not pretend to. The
topic divides by whether the condition is mechanically provable.

### 2a — streamed not-found render. Provable.

**threshold:** target returns 200 carrying `<meta name="robots"
content="noindex">`, and the repo does not declare `noindex` for that route
(checked at all three declaration sites — topic 70).

**detect:** as topic 1's discriminator. Same code path, different entry point:
topic 1 finds it via an inbound anchor, topic 2 finds it by crawling the URL
directly.

**fix:** move the existence check before any `await` or `<Suspense>` boundary
so `notFound()` fires pre-stream and a real 404 is sent. Alternative:
configure `htmlLimitedBots` so matching agents receive unstreamed responses.

**postcondition:** the live response for that URL returns 404, asserted via a
code path separate from the executor.

**idempotent:** yes.

**blast radius:** the route file for the check relocation; `next.config` for
the `htmlLimitedBots` route. Config changes are shared — lower autonomy cap.

**rollback:** revert commit.

**verdict:** `auto-fixable` where the repo declares no `noindex` and
`generateMetadata` does not set `robots` conditionally. `human-review`
otherwise.

### 2b — error-like or empty content on a 200. Not provable.

Covers: explicit error text, blank or near-blank main content, empty category
or internal-search results, render failures from missing resources.

**threshold:** none available. Every signal here requires judging whether
content is "effectively missing," which is the classifier Google does not
publish.

**Text matching is rejected** — already rejected in topic 1 for the same
reason. Searching for "page not found", "0 items found" or similar is
site-specific, locale-specific, and broken by any redesign.

**verdict:** `not_mechanically_fixable`. Report the observation, hand a human
the task. Never auto-fix.

## reporting language

Output must say **"potential soft 404"** for anything in 2b, never "soft 404".
SEORANKO observes a 200 with error-like characteristics; it does not reproduce
Google's classification. Claiming otherwise is a claim the product cannot
support.

2a may be stated flatly: the route serves 200 with an injected `noindex` and
the repo declares none. That is provable.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Repo declares `noindex` for the route | valid page, deliberately excluded. Never raise |
| 2 | `generateMetadata` sets `robots` conditionally | indeterminate. Human-review |
| 3 | Response is 503, 429 or 5xx | availability problem. Never this finding (topic 68) |
| 4 | Page renders content only after hydration | see topic 67. Do not assess pre-hydration HTML as empty |
| 5 | Middleware rewrite serves this path from another route | resolve via topic 70 before assessing |

### Explicitly rejected

- **Text matching for error phrases.** Rejected in topic 1; same reasoning.
- **Reproducing Google's soft-404 classifier.** Not published. Any attempt is
  a guess presented as a threshold.
- **Treating a 301 to an unrelated page as a soft 404.** Reported as common
  practice but no primary source found. If pursued, it belongs to topic 7
  (redirects whose target is not a 200) and needs its own verification.

## fixture

Synthetic repo containing: a dynamic route with `loading.tsx` whose
`notFound()` fires mid-stream; the same route with the check moved
pre-stream; a deliberately noindexed valid page; a route whose
`generateMetadata` sets `robots` conditionally.

CI asserts: finding raised for the first, not raised for the second or third,
and human-review returned for the fourth.

## Open questions

(none — Google soft-404 wording confirmed against live docs; see `_sources.md`
row 27)

## Cross-references

- topic 1 — same discriminator, opposite entry point. The two must stay in
  agreement.
- topic 60 — thin content. 2b overlaps it; decide which owns the report.
- topic 67 — pre-hydration assessment.
- topic 68 — status evidence rules.
- topic 70 — site model and the `noindex` declaration check.
