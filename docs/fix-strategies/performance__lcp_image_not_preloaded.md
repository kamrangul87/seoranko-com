# performance__lcp_image_not_preloaded

Status: READY — mostly not mechanically fixable
Topic: 51 of the issue register
Tier: C (with one narrow A-minus slice)
Shared facts: `_performance_adjacent_shared_facts.md`
Research title: perf__lcp_resource_late_discovered (topic 51).
Research date: 2026-09-15

---

## what's actually wrong

Possibly nothing. The topic as listed — "LCP image not preloaded" — assumes
preload is a general improvement. It is not.

## threshold

Two verified facts bound this topic tightly:

- **P12: preload only when the resource is late-discovered**, such as a CSS
  background image
- **P11: the LCP URL should be discoverable directly in the initial HTML**

Together these say the *preferred* fix is making the resource discoverable in
HTML, not adding a preload. A preload compensates for late discovery; it is
not a performance upgrade to apply broadly.

And as with topic 50, **the LCP element cannot be identified from served
HTML**. So "the LCP image is not preloaded" is not a provable condition.

| Condition | Source | Provable? | Treatment |
|---|---|---|---|
| a hero image is set via CSS `background-image` rather than `<img>` | P12 | **yes** — the declaration is in the stylesheet | A-minus: report as a late-discovery pattern |
| `<link rel="preload" as="image">` for an image that is **not** referenced anywhere in the served HTML or CSS | — | yes | A-minus: a preload for an unused resource, deterministic waste |
| more than two images carry `fetchpriority="high"` | P10 | yes | low-severity observation |
| a preload exists for a resource already discoverable early in HTML | P12 | yes | low-severity: the preload is unnecessary |
| "the LCP image is not preloaded" | P11, P12 | **no** | `not_mechanically_fixable` |
| LCP is slow | — | no | topic 61 |

## detect

1. Collect `<link rel="preload">` elements with their `as` and `href`.
2. Collect `<img>` sources and CSS `background-image` URLs from same-origin
   stylesheets.
3. Run only the four provable rows above.
4. Assess served HTML (topic 67).

## fix

- **preload for a resource referenced nowhere** → remove it. Deterministic; it
  fetches a resource the page does not use.
- **CSS background hero** → **no automatic fix.** Converting a CSS background
  to an `<img>` changes markup semantics, layout, and often accessibility
  (an `alt` value is needed, which is content). Report the pattern with P12
  named, and let a human decide.
- **redundant preload** → removal is deterministic but low value; propose it
  when the file is already being changed.
- **more than two high-priority images** → report only.

Explicitly not part of the fix: adding a preload for a guessed LCP image.
That requires the unprovable identification, and P12 says preload is the
wrong tool unless discovery is genuinely late.

## postcondition

Where a fix is applied: the served HTML contains no `preload` for a resource
absent from the document and its same-origin stylesheets.

**No LCP claim.** Field metric.

## idempotent?

Yes.

## risk / blast radius

Preloads usually sit in a shared layout, so a removal affects every page. A
preload removed in error costs a round trip; a preload added in error wastes
bandwidth on every page load — which is why only removal of demonstrably
unused preloads is automated.

## rollback

Revert.

## verdict

`auto-fixable` only for removing a preload whose resource is referenced
nowhere in the document or its stylesheets.

`not_mechanically_fixable` for everything relating to the LCP element itself.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | The LCP element is inferred from markup | **not provable.** Never a finding |
| 2 | Preloaded resource is referenced in a stylesheet not fetched by the detector | fetch same-origin stylesheets before concluding it is unused |
| 3 | Preloaded resource is used conditionally by JavaScript | may be legitimate. `human-review`, never auto-remove |
| 4 | Preload is for a font, script or style rather than an image | different `as` values; assess each on its own terms |
| 5 | `as` attribute absent from the preload | separate defect — a preload without `as` may be fetched twice |
| 6 | CSS background image used deliberately for a decorative hero | not a defect. Report the pattern only |
| 7 | An LCP improvement is claimed | not assertable. Reword |
| 8 | Resource referenced only in the hydrated DOM | assess served HTML (topic 67) |

### Explicitly rejected

- **Adding a preload for a guessed LCP image.** P12 — preload is for late
  discovery, and the element is unidentifiable.
- **Converting CSS background images to `<img>` automatically.** Changes
  semantics and needs `alt` content.
- **Claiming preload improves LCP generally.** P12.
- **Any LCP metric assertion.**

## fixture

A preload for an image referenced nowhere; a preload for an image referenced
in a same-origin stylesheet; a preload without `as`; a CSS background hero; a
preload used conditionally by JS; five images with `fetchpriority="high"`.

CI asserts: auto-fix for the first; **nothing** for the second; defect raised
for the third; pattern reported for the fourth; `human-review` for the fifth;
observation for the sixth. **No finding claims to identify the LCP element.**

## Cross-references

- topics 49, 50, 52; topic 61 (LCP as a metric, Tier C); topic 62; topic 67
