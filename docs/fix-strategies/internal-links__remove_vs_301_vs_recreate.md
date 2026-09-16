# internal-links__remove_vs_301_vs_recreate

Status: READY — implemented, see topic 1
Topic: 41 of the issue register
Tier: A
Shared facts: `_internal_links_shared_facts.md`
Research title: links__dead_anchor_branch_decision (topic 41).
Research date: 2026-09-15

---

## what this is

The routing decision for a dead internal link: remove the anchor, redirect to
a successor, or recreate the destination.

**This is not a separate detector.** Detection lives in topic 1; this dossier
records the decision tree and its evidence requirements as a single reference,
because it is shared by topics 1, 7 and 26.

Implementation status: built and passing in CI as part of topic 1 (PR #73).
This dossier documents what was built, and corrects one row.

## the tree

| Evidence | Outcome | Verdict |
|---|---|---|
| target returns 410 | remove anchor | `auto-fixable` — server declared permanence (RFC 9110 §15.5.11) |
| target 404, git shows deletion, zero successors | remove anchor | `auto-fixable` |
| target 404, exactly one successor above the similarity floor | propose 301 | `human-review` |
| target 404, two or more successors above the floor | no proposal | `human-review` — never tie-break |
| target 404, git shows no deletion, zero successors, site model `no-route` / indeterminate / unknown | **no action** | `human-review` — intent unknown (guard 9) |
| target 404 (or soft-404), git shows no deletion, zero successors, site model `dynamic-route` only | **no action** | `human-review` — pattern ≠ resource (guard 9) |
| target 404, git shows no deletion, zero successors, site model `static-route` (exact page file) | recreate-scaffold | `human-review` — exact path file is positive site-model evidence |
| target 404, git history unavailable | no action | `human-review` — absence of evidence is not evidence |

`recreate-scaffold` from "no deletion + any route kind" was wrong. Guard 9
covers absence of deletion evidence when the site model does not prove the
*resource* should exist. A dynamic pattern (`app/blog/[slug]/page.tsx`)
matching `/blog/missing-post` proves a pattern, never that the slug was
intended — same lesson as topic 70's soft-404 discriminator. Scaffolding
there would invent intent; for a streamed soft 404 it would also imply
generating slug content, which is out of bounds.

## evidence sources, in order of strength

1. **Target status.** 410 versus 404 is a declaration by the server about
   permanence. Deterministic, free, and decides the tree's top branch.
   Soft-404 (200 + injected noindex) follows the same tree once the topic 70
   discriminator confirms the destination is gone.
2. **Git history of the connected repo.** Whether the route ever existed and
   when it was deleted. Path candidates must come from the site model's
   detected route roots (topic 70), not a default `app/**` list — this was a
   real defect found on a live run.
   Three states, never two: `deleted`, `no-deletion-found`,
   `history-unavailable`. Shallow clones and probe failures yield the third.
3. **Successor similarity.** Path similarity plus main-content similarity,
   with a floor. **Exactly one** candidate above the floor is required; two or
   more is `human-review`, not a tie to break.
4. **GSC impressions.** `connection-required`. Never gates a branch — the tree
   must produce an outcome on sites with no GSC connection.

**External inbound links are not an available input.** No backlink API. They
must not appear in the tree.

## the recreate branch

Scaffold only, never content. Proposed only where there is **positive**
evidence the *exact* resource should exist:

- site model `static-route` (exact page file for this path), or
- a sitemap or GSC record of the URL (not yet wired into `decide404Branch`)

Never proposed from absence, and never from a `dynamic-route` pattern match
alone.

**What the implementation emits today:** the decision label
`recreate-scaffold` on the finding — an empty-route-stub *proposal* for human
review. There is no executor that writes a page file or generates slug copy.
Content generation is explicitly out of bounds.

For legal or policy pages the topic 44 rule applies: scaffold the route,
never generate the copy.

## postcondition

Per branch, asserted on the live response via a code path separate from the
executor:

- remove: the source page's served HTML no longer contains the href
- 301: the old URL returns 301 and its target returns 200 in one hop
- recreate: the URL returns 200 without injected `noindex`

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Git path candidates not derived from the site model | the evidence is invalid. Return `history-unavailable` |
| 2 | Shallow clone with no deletion match | `history-unavailable`, never `no-deletion-found` |
| 3 | Positive deletion found on a shallow clone | **trust it.** Shallowness invalidates absence, not presence |
| 4 | Two or more successors above the floor | never tie-break |
| 5 | Successor is the homepage | reject. Redirecting a deleted page to the homepage is a soft-404 pattern (topic 7) |
| 6 | Proposed 301 target is itself non-200 or a redirect | resolve first (topics 4, 7) |
| 7 | GSC not connected | the tree must still return an outcome |
| 9 | No deletion evidence + zero successors, and site model does not prove the resource (`no-route` / indeterminate / unknown / **`dynamic-route` pattern only**) | `no-action`, `human-review`. Never `recreate-scaffold` |

### Explicitly rejected

- **`recreate-scaffold` from absence of evidence.** Corrected during
  implementation; extended so dynamic pattern match cannot bypass guard 9.
- **`recreate-scaffold` as slug content generation.** Out of bounds. The
  action is a stub proposal label only.
- **Tie-breaking between successors.**
- **Redirecting to the homepage.**
- **Any branch gated on external backlink data.**

## Cross-references

- topic 1 detection and implementation; topic 7 redirect targets; topic 26
  sitemap entries; topic 44 legal-page scaffolding; topics 68, 70
