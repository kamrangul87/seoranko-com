# indexability__noindex_on_should_be_indexed

Status: READY — report-only
Topic: 19 of the issue register
Tier: A (detect) / C (fix)
Shared facts: `_robots_shared_facts.md`
Research title: noindex_on_page_that_should_index (topic 19).
Research date: 2026-09-15

---

## what's actually wrong

A page carries `noindex` while the site's own other signals treat it as
content meant to be found.

## threshold

**"Should be indexed" is intent and is not mechanically knowable.** The agent
cannot decide a page deserves indexing. What it *can* prove is that the site
contradicts itself.

The finding is a **signal contradiction**, and requires at least one of:

- the page is listed in the site's own XML sitemap **and** declares `noindex`
- the page carries a self-referential canonical **and** declares `noindex`
- another page's canonical points at this page **and** this page declares
  `noindex` (this is topic 15 seen from the other side)

A page that declares `noindex`, is absent from the sitemap, and is not a
canonical target is **not a finding**. It is a deliberate exclusion working
correctly.

## detect

1. Read the page's robots directives: meta tag (`robots` and `googlebot`) and
   `X-Robots-Tag`. Case-insensitive (R3). Expand `none` to `noindex, nofollow`
   (R7).
2. Confirm the directive is repo-declared, not injected (topic 70). Injected
   `noindex` is a streamed not-found render — topic 2a, not this.
3. Check sitemap membership and canonical relationships.
4. Raise only on a proven contradiction.

## fix

**None applied.** Removing a `noindex` makes a page publicly indexable. That
is a visibility decision and may expose content the owner deliberately hid —
staging pages, thin pages, internal tools, gated content.

The agent reports the contradiction and both possible resolutions:

- the page should be indexed → remove `noindex`
- the page should stay excluded → remove it from the sitemap, and fix any
  canonical pointing at it

## postcondition

Where a human applies a fix: either the live response no longer carries
`noindex`, or the sitemap no longer lists the URL. Asserted separately.

## risk / blast radius

A `noindex` declared in `layout.tsx` cascades to every child page. Report the
cascade source, not each affected page individually.

## verdict

`not_mechanically_fixable` for the fix. `auto-detectable` for the
contradiction. Report with evidence and both resolutions.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | `noindex` is injected, not repo-declared | topic 2a. Never raise here |
| 2 | Page is absent from sitemap and not a canonical target | deliberate exclusion. Never raise |
| 3 | `noindex` comes from a layout cascade | report the cascade source once |
| 4 | Page is a staging, preview, or auth-gated route | deliberate. Never raise |
| 5 | `generateMetadata` sets robots conditionally | `indeterminate` |
| 6 | Directive appears only in `<body>` | still respected by Google (R8). Not a placement defect |
| 7 | Page is also blocked by robots.txt | topic 23's conflict applies first — the `noindex` is not even being seen |

### Explicitly rejected

- **Auto-removing `noindex`.** Same reasoning as topic 15, and the same
  answer. A deliberate exclusion is a business decision.
- **Treating absence from the index as evidence the page should be indexed.**
- **Inferring "should be indexed" from page quality or word count.**

## fixture

Page with repo-declared `noindex` listed in the sitemap; with injected
`noindex`; with `noindex` and absent from the sitemap; with a layout cascade;
with conditional `generateMetadata`; with `none` instead of `noindex`.

CI asserts: raised for the first; routed to topic 2a for the second;
suppressed for the third; cascade source reported for the fourth;
`indeterminate` for the fifth; `none` correctly expanded for the sixth.

## Cross-references

- topic 2a injected noindex; topic 15 canonical to noindexed; topic 20
  directive conflict; topic 23 robots.txt conflict; topic 27 sitemap
