# performance__lazy_on_lcp_hero

Status: READY — narrow provable slice only
Topic: 50 of the issue register
Tier: A-minus (narrow slice) / C (the rest)
Shared facts: `_performance_adjacent_shared_facts.md`
Research title: perf__lazy_loading_on_lcp_candidate (topic 50).
Research date: 2026-09-15

---

## what's actually wrong

`loading="lazy"` is applied to an image that is the LCP element or is in the
initial viewport, delaying the fetch that determines LCP.

## the scope problem, stated first

**The LCP element cannot be identified from the served HTML.** It depends on
viewport size, device, rendered layout, CSS, and what the user's browser
actually paints. web.dev's rule is unambiguous — never lazy-load the LCP image
(P7) — but *which* image is the LCP image is a rendering-time fact.

So "above the fold" is not a mechanical property either. Under the hard filter
that disqualifies the general case.

The topic therefore splits.

### 50a — contradictory directives. Provable.

| Condition | Source | Severity |
|---|---|---|
| the same `<img>` carries `loading="lazy"` **and** `fetchpriority="high"` | P7, P9, P10 | **high** — internally contradictory: the markup asks the browser to deprioritise and prioritise the same resource |
| `loading="lazy"` on an image also named in a `<link rel="preload">` | P7, P12 | high — same contradiction across two elements |
| `loading="lazy"` on an image that is the **only** image in the served HTML and appears before any other content-bearing element | P7 | moderate — strong structural signal, still a heuristic, and labelled as one |
| `loading="eager"` present with no `fetchpriority` | P8, P9 | **none.** Eager is the default; this is redundant, not wrong |
| `loading="lazy"` on any other image | P13 | **none.** This is the recommended use |

Rows one and two compare two declarations in the same document — the same
structured-vs-structured standard used in topic 38a. No rendering required.

### 50b — "is this image above the fold". Not provable.

**threshold:** none available. Requires rendering at a specific viewport.

**verdict:** `not_mechanically_fixable`. The product may report which images
carry `loading="lazy"` and their document position as an observation, clearly
labelled as position in source order rather than viewport position. It does
not assert that any of them is the LCP element.

## detect

1. Parse served HTML; collect every `<img>` with `loading`, `fetchpriority`,
   `src`, and document position.
2. Collect `<link rel="preload" as="image">` hrefs.
3. Run only the 50a comparisons.
4. Assess served HTML, not the hydrated DOM (topic 67).

## fix

- **`loading="lazy"` with `fetchpriority="high"`** → remove `loading="lazy"`.
  Deterministic: the two directives conflict and the author's `fetchpriority`
  declares the intent.
- **`loading="lazy"` on a preloaded image** → remove `loading="lazy"`. Same
  reasoning.
- **the single-image heuristic row** → `human-review`. A heuristic does not
  earn an automatic change.
- **redundant `loading="eager"`** → no fix. It is harmless and may exist
  deliberately to stop tooling adding lazy loading (P9).

Note what is **not** part of the fix: adding `fetchpriority="high"`. That
requires knowing the image is the LCP candidate, and P10 limits it to one or
two images per page. Adding it speculatively is rejected.

## postcondition

Live: no `<img>` in the served HTML carries both `loading="lazy"` and
`fetchpriority="high"`, and no preloaded image carries `loading="lazy"`.

## idempotent?

Yes.

## risk / blast radius

Usually a shared image component. Removing `loading="lazy"` from a component
makes **every** image it renders eager, which is the opposite problem (P13).
Where the attribute comes from a component default, the fix is per-instance,
not to the default.

## rollback

Revert.

## verdict

`auto-fixable` for the two contradictory-directive rows only.

`human-review` for the single-image heuristic.

`not_mechanically_fixable` for identifying the LCP element or above-fold
position.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | `loading="lazy"` on a below-fold image | **recommended** (P13). Never raise |
| 2 | Above-fold position inferred from source order | heuristic. Label it; never auto-fix from it |
| 3 | `loading="eager"` with no `fetchpriority` | redundant, not wrong (P8, P9) |
| 4 | Removing `loading="lazy"` from a shared component default | makes all images eager. Fix per instance |
| 5 | Image is CSS background rather than `<img>` | `loading` does not apply; late discovery is topic 51's P12 case |
| 6 | Markup injected client-side | assess served HTML (topic 67) |
| 7 | An LCP improvement is claimed | not assertable. Reword |
| 8 | `fetchpriority="high"` on more than two images | separate low-severity observation (P10), not this finding |

### Explicitly rejected

- **Determining the LCP element from HTML.** Rendering-time fact.
- **Treating source order as viewport position.**
- **Adding `fetchpriority="high"` speculatively.** P10.
- **Removing `loading="lazy"` wholesale.** P13 — it is the correct default for
  below-fold images.
- **Claiming an LCP improvement.**

## fixture

An `<img>` with `loading="lazy"` and `fetchpriority="high"`; a preloaded image
with `loading="lazy"`; a page with one image, lazy, first in source order; a
below-fold image with `loading="lazy"`; an image with `loading="eager"` only;
four images with `fetchpriority="high"`.

CI asserts: auto-fix for the first and second; `human-review` labelled as a
heuristic for the third; **nothing** for the fourth and fifth; low-severity
observation for the sixth.

## Cross-references

- topics 49, 51, 52; topic 38a (same structured-vs-structured standard);
  topics 61, 62 (metric and render-blocking, both Tier C); topic 67
