# sitemap__indexable_urls_absent

Status: READY
Topic: 27 of the issue register
Tier: A
Shared facts: `_sitemap_shared_facts.md`
Research date: 2026-09-15

---

## what's actually wrong

Indexable pages the site serves are not listed in its sitemap.

## threshold

This is the inverse of topic 26, and it is **weaker**, because omission is not
a documented error. Google discovers URLs by crawling; a sitemap is an aid,
not a requirement.

The finding requires a URL that is provably indexable and provably absent:

- returns 200 on re-fetch (topic 68)
- carries no `noindex` in meta or header
- is self-canonical, or canonicalises to itself
- is reachable from the site's own internal links
- is **not** matched by any `Disallow` for Googlebot (topic 21's matcher)
- and does not appear in any declared sitemap or sitemap index

All six required. Anything less and the omission may be deliberate.

Severity is low by default. It rises where the page is also orphaned
(topic 43) — a page absent from both the sitemap and internal links is
genuinely undiscoverable.

## detect

1. Build the set of all declared sitemap `loc` values, following any index.
2. Build the set of crawled indexable URLs meeting the six conditions.
3. Difference → candidates.
4. Normalise both sets before comparing, using the topic 5 rules — resolve
   relative, lowercase scheme and host, resolve dot segments. Do **not**
   collapse trailing slash, case, query or port: `/page` in the sitemap and
   `/page/` on the site are a genuine mismatch, and belong to topic 8.

## fix

Add the URL to the sitemap — or to the generator where one exists.

Adding is riskier than the removal in topic 26: it advertises a URL to Google.
If the page should not have been public, the sitemap entry makes that worse.

## postcondition

Live sitemap contains the URL, and the URL returns 200 and is indexable.

## idempotent?

Yes.

## risk / blast radius

One file or the generator. But the effect is outward-facing: it invites
crawling of a page that previously was not advertised.

## verdict

`human-review` by default. Whether a page belongs in the sitemap is the
owner's decision, and omission is not a documented defect.

`auto-fixable` only where the sitemap is generated from the route tree and the
omission is demonstrably a generator bug — a page the generator should have
included by its own rules but did not.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Page carries `noindex` | deliberately excluded. Never raise |
| 2 | Page is `Disallow`ed for Googlebot | deliberately excluded from crawling. Never raise |
| 3 | Page canonicalises to a different URL | the canonical belongs in the sitemap, not this URL (S15) |
| 4 | Normalisation collapsed a real slash or case difference | the mismatch is topic 8 or 11, not an omission |
| 5 | Page is a paginated, filtered, or parameterised variant | may legitimately be omitted |
| 6 | Page is staging, preview, or auth-gated | never raise |
| 7 | Sitemap index not followed | the URL may be listed in a child sitemap. Follow indexes before concluding absence |
| 8 | Adding the page would exceed 50,000 URLs (S9) | the fix requires a split first (topic 25) |

### Explicitly rejected

- **Treating sitemap omission as an error.** Not documented as one.
- **Adding every crawled 200 URL to the sitemap.** Would advertise
  parameterised variants, filters and pages the owner left out deliberately.
- **Concluding absence without following sitemap indexes.**

## fixture

Indexable page absent from the sitemap and internally linked; a `noindex`
page absent; a `Disallow`ed page absent; a page listed in a child sitemap of
an index; `/page/` on the site with `/page` in the sitemap; a page
canonicalising elsewhere; a page absent from both sitemap and internal links.

CI asserts: low-severity finding for the first; suppressed for the second,
third and fourth; routed to topic 8 for the fifth; suppressed for the sixth;
elevated severity plus topic 43 cross-reference for the seventh.

## Cross-references

- topic 26 is the inverse; topics 5, 8, 11 normalisation; topic 21 matcher;
  topic 25 limits; topic 43 orphan pages; topics 68, 70
