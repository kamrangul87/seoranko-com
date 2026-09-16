# performance__images_missing_width_height

Status: READY — implemented, see `TOPIC49_STAGE_REPORT.md`
Topic: 49 of the issue register
Tier: A-minus
Shared facts: `_performance_adjacent_shared_facts.md`
Research title: perf__img_missing_dimensions (topic 49).
Research date: 2026-09-15

---

## what's actually wrong

An `<img>` has no `width`/`height` attributes, so the browser cannot reserve
layout space before the image downloads.

## threshold

An `<img>` in the served HTML lacks `width`, lacks `height`, or has values
whose ratio does not match the image's intrinsic ratio.

| Condition | Source | Severity |
|---|---|---|
| both attributes absent | P1, P2 | moderate |
| one attribute present, the other absent | P2 | moderate — no ratio derivable |
| both present but ratio ≠ intrinsic ratio | P3, P6 | **high** — wrong values still cause a shift |
| `srcset` candidates with differing ratios | P5 | moderate |
| present, correct, with `max-width:100%; height:auto` in CSS | P4 | correct. Not a finding |

The third row matters most: **wrong dimensions are worse than absent ones**
(P6), so a fixer that guesses values creates a higher-severity defect than the
one it closes.

**No CLS claim.** The postcondition is the attributes' presence and
correctness, not a measured layout-shift improvement.

## detect

1. Parse the served HTML; collect every `<img>` with its `width`, `height`,
   `src` and `srcset`.
2. Fetch each image and read its intrinsic dimensions from the file header —
   not the full file.
3. Compare declared ratio to intrinsic ratio within a tolerance recorded as a
   product decision (rounding is unavoidable at integer attribute values).
4. For `srcset`, compare candidate ratios to each other (P5).

## fix

Set `width` and `height` to the intrinsic dimensions read from the image file.

**This is the one branch in the block with a genuinely authoritative source
for the value** — the image's own header. Not a guess, not a default.

Where the intrinsic dimensions cannot be read — image behind auth, unsupported
format, fetch failure — the fix is `human-review`. Never invent values.

## postcondition

Live: every `<img>` in the served HTML carries `width` and `height` whose
ratio matches the fetched image's intrinsic ratio within tolerance.

## idempotent?

Yes.

## risk / blast radius

A single page file for a content image; a **shared component** for logos,
avatars and card thumbnails, which changes every page it renders on. Where
images come from a CMS or data source, the fix belongs in the component that
renders them, not in each instance.

Adding attributes can **change rendered layout** if the CSS does not include
`height: auto` (P4) — the image may render at its intrinsic size. Check for
that CSS before applying.

## rollback

Revert.

## verdict

`auto-fixable` where the intrinsic dimensions are readable and the CSS already
contains `height: auto` or equivalent for that image.

`human-review` where the CSS does not constrain height (applying attributes
may change layout), where dimensions are unreadable, or where the image is
rendered by a shared component with variable sources.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Dimensions absent but the element has `aspect-ratio` in CSS | space is already reserved. Low severity at most |
| 2 | CSS lacks `height: auto` | applying attributes may change rendered size (P4). `human-review` |
| 3 | Image is decorative with `alt=""` and zero layout impact | low severity |
| 4 | Intrinsic dimensions unreadable | never guess (P6). `human-review` |
| 5 | Image is an SVG with a `viewBox` and no intrinsic size | different rules; do not apply pixel dimensions |
| 6 | Image injected client-side after hydration | assess served HTML (topic 67) |
| 7 | Declared ratio differs only by integer rounding | within tolerance. Never raise |
| 8 | A CLS improvement is claimed | not assertable. Reword |

### Explicitly rejected

- **Guessing dimensions or using defaults.** P6 — wrong values still shift.
- **Claiming a CLS improvement.** Field metric.
- **Applying attributes without checking the CSS.** Can change layout.
- **Editing generated output** where images are rendered by a component.

## fixture

`<img>` with no dimensions and `height:auto` CSS; with no dimensions and no
height CSS; with a 4:3 declared ratio on a 16:9 image; with correct
dimensions; an SVG with a `viewBox`; an `<img>` whose source 404s; a `srcset`
with mismatched candidate ratios.

CI asserts: auto-fix for the first; `human-review` for the second and sixth;
**high** severity for the third; nothing for the fourth and fifth; moderate
for the seventh.

## Cross-references

- topics 50, 51; topic 36 (unreachable image URLs); topic 67
