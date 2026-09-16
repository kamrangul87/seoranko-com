# internal-links__pointing_at_redirects

Status: READY — implemented, see `TOPIC42_STAGE_REPORT.md`
Topic: 42 of the issue register
Tier: A
Shared facts: `_internal_links_shared_facts.md`
Research title: links__pointing_at_redirects (topic 42).
Research date: 2026-09-15

---

## what's actually wrong

An internal link points at a URL that redirects, rather than at the final
destination.

## threshold

An internal `<a href>` target returns 3xx and resolves to a healthy 200.

**This is not breakage.** The link works; Googlebot follows up to 10 hops
(N15). The finding is an inefficient and conflicting site signal: Google's
guidance is to link to the canonical URL rather than a duplicate (N13), and on
site moves to update internal links to the new URLs (N14).

Severity by chain length, using Google's own soft numbers (N15):

| Chain from the link target | Severity |
|---|---|
| 1 hop to a healthy 200 | low |
| 2–3 hops | moderate — within Google's "ideally no more than 3" |
| 4 hops | high — beyond ideal, approaching the "fewer than 5" advice |
| 5 or more hops | high |
| more than 10 hops | topic 4, not this finding — Google abandons it |
| resolves to non-200 | topic 1 or topic 7, not this finding |

## detect

1. Extract internal `<a href>` values. Scheme filter first.
2. Fetch each target without following redirects; record the chain.
3. Chain resolves to 200 → this finding. Resolves to non-200 → topic 1.
   Loops → topic 5. Exceeds 10 → topic 4.
4. Re-fetch per topic 68.

## fix

Rewrite the `href` to the final destination URL.

**The five conditions from Google's guidance must all hold** before this is
applied mechanically:

1. destination is internal
2. the redirect is a stable 301 or 308
3. the final target is healthy, indexable and canonical
4. no loop and no further ambiguity in the chain
5. meaningful query parameters and fragments are preserved

Condition 5 is the one most easily lost: rewriting `/old?utm_source=x#section`
to `/new` silently drops both the campaign parameter and the fragment.

## postcondition

Live: the source page's served HTML contains the final URL, and that URL
returns 200 in zero redirects. Asserted via a code path separate from the
executor.

## idempotent?

Yes — but it breaks if the destination later moves, so the target must be
re-verified at application time.

## risk / blast radius

A single page file for a body link; a **shared nav, header or footer** for a
navigation link, which changes every page at once. Resolve the declaration
site via topic 70 and report navigation links separately from body links.

## rollback

Revert.

## verdict

`auto-fixable` where all five conditions hold and the link is in a single page
file.

`human-review` where the link is in shared navigation, or where the redirect
is temporary, conditional, authentication-based, locale-based or
device-based — replacing the source link in those cases **changes behaviour**,
because the redirect was doing work.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Redirect is 302/307 | temporary. Rewriting the link removes the site's ability to change the target. `human-review` |
| 2 | Redirect is conditional — auth, locale, device, geo, A/B | never auto-rewrite. The redirect is the feature |
| 3 | Query parameters or fragment would be dropped | preserve them, or `human-review` |
| 4 | Final target is not canonical | fix the canonical first (topics 13–18); linking to a non-canonical URL contradicts N13 |
| 5 | Chain resolves to non-200 | topic 1 or 7 |
| 6 | Chain loops | topic 5 |
| 7 | Link is external | out of scope. No repo transform for another site's redirects |
| 8 | Redirect produced by middleware | resolve via topic 70; `indeterminate` if not statically resolvable |
| 9 | Link is in shared navigation | report once naming the component, not once per page |

### Explicitly rejected

- **Claiming crawl-budget waste or PageRank dilution.** Unsourced.
- **Auto-rewriting links through conditional redirects.**
- **Dropping query strings or fragments during the rewrite.**
- **Rewriting to a target that is not the canonical.** N13.
- **Reporting one finding per page for a shared-nav link.**

## fixture

Internal link to a single 301 resolving to 200; to a 3-hop chain; to a 5-hop
chain; to a 302; to a locale redirect; a link with `?utm_source=x#section`
through a redirect; a nav link through a redirect appearing on 20 pages; a
link to a redirect resolving to 404.

CI asserts: auto-fix for the first; moderate for the second; high for the
third; `human-review` for the fourth and fifth; parameters preserved in the
sixth; **one** finding naming the component for the seventh; routed to topic 1
for the eighth.

## Cross-references

- topics 1, 4, 5, 7 chain handling; topics 8–12 and 13–18 for canonical
  targets; topics 68, 70
