# duplicate-url__query_parameter_variants

Status: READY — narrow scope
Topic: 12 of the issue register
Tier: A (tracking parameters only) / C (everything else)
Template: topic 8
Research dates: 2026-09-15

---

## what's actually wrong

A parameterised URL returns 200 with content duplicating the clean URL.

## primary source

- Google, Canonicalization and how to specify a canonical URL —
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google, URL structure best practices —
  https://developers.google.com/search/docs/crawling-indexing/url-structure
- Google, Designing a URL structure for ecommerce sites —
  https://developers.google.com/search/docs/specialty/ecommerce/designing-a-url-structure-for-ecommerce-sites

### Verified facts

| Fact | Status |
|---|---|
| Google treats parameter URLs as distinct URLs initially | verified |
| Where primary content is duplicate or very similar, Google clusters them, selects a representative canonical, consolidates signals, and crawls duplicates less often | verified |
| Google recommends trimming parameters that do not change content | verified |
| Parameters that alter filters, products, pagination or other meaningful content are **not** mechanically duplicates | verified |
| The GSC URL Parameters Tool was deprecated | verified |
| `noindex` and `robots.txt` are **not** canonicalization fixes | verified |

**Not adopted:** the recommendation to block parameters in `robots.txt`.
Directly contrary to the source: blocking crawl prevents Google from seeing
the canonical at all. Also not adopted: crawl-budget-waste framing.

## the scope problem

Whether a parameter changes meaningful content is **not decidable from the
URL**. `?sort=price` may reorder a list or may return a different product set.
This makes most of topic 12 non-mechanical.

So the topic is deliberately narrow:

### 12a — known tracking parameters. Provable.

**threshold:** the URL carries only parameters from a fixed allow-list of
tracking or session parameters (`utm_*`, `gclid`, `fbclid`, `sessionid` and
similar), **and** the response content is identical to the clean URL.

Both conditions required. The name alone is not sufficient evidence.

**fix:** redirect to the clean URL where the variant need not stay
accessible; `rel="canonical"` to the clean URL where it must.

**verdict:** `human-review` by default; `auto-fixable` where the parameter is
on the list, content is byte-identical, and a canonical annotation (not a
redirect) is the chosen branch — canonical is reversible, a redirect on a
tracking URL can break campaign links.

### 12b — everything else. Not provable.

Filters, sorts, pagination, faceted navigation, search results, and any
parameter not on the list.

**threshold:** none. Deciding whether the parameter changes meaningful content
is the judgement Google's own systems make and do not publish.

**verdict:** `not_mechanically_fixable`. Report the parameter patterns
observed and the duplicate clusters, hand a human the decision.

Infinite faceted or search spaces are a crawl-control question, not a
canonicalization one, and out of scope for the fix agent.

## detect

1. Group crawled 200 URLs by path, collecting parameter sets.
2. For each parameterised URL, fetch the clean path.
3. Compare content. Identical → candidate.
4. Classify: all parameters on the tracking list → 12a. Otherwise → 12b.
5. Re-fetch per topic 68.

## postcondition

12a canonical branch: live response for the parameterised URL carries a
`rel="canonical"` to the clean URL, which returns 200.
12a redirect branch: parameterised URL returns 301 to the clean URL.

## idempotent?

Yes for the canonical branch. The redirect branch is not, if the clean URL
later moves.

## risk / blast radius

Canonical annotation: the page or layout template. Redirect: build config,
site-wide, and **can break paid campaign tracking** — call that out in any
proposed redirect.

## rollback

Revert. Note a 301 may be browser-cached.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Parameter changes the main content | never raise. Not a duplicate |
| 2 | Parameter is pagination | never raise. Distinct pages |
| 3 | Parameter drives faceted navigation | 12b, report only |
| 4 | Parameter name is on the tracking list but content differs | never raise. The name is not the evidence |
| 5 | Removing the parameter would break campaign attribution | prefer the canonical branch over the redirect; state the risk |
| 6 | Parameter carries auth, a token or a signed value | never redirect or canonicalize |
| 7 | Clean path returns non-200 | this is not a duplicate-URL finding |

### Explicitly rejected

- **`robots.txt` blocking of parameter patterns.** Contrary to the source:
  it prevents Google from seeing the canonical.
- **`noindex` on parameter URLs.** Not a canonicalization fix.
- **Inferring parameter meaning from its name.** `?id=`, `?p=`, `?s=` mean
  different things on different sites.
- **Auto-redirecting tracking parameters.** Breaks campaign links; canonical
  is the safer branch.

## fixture

`?utm_source=x` with identical content; `?sessionid=` with identical content;
`?sort=price` with reordered content; `?page=2` with different content;
`?utm_source=x` where content differs; a signed-token parameter.

CI asserts: 12a for the first two; 12b report-only for the third and fourth;
suppressed for the fifth and sixth.

## Cross-references

- topics 8 (template), 9, 10, 11
- topics 13–18 canonical
- topic 60 — thin content, where empty filter results overlap
