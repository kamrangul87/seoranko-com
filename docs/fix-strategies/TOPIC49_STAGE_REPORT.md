# Topic 49 report — images missing width/height

Date: 2026-09-16
Branch: `cursor/topic49-img-dimensions-922c`

## Built

`src/lib/fix-strategies/topic-49/`

- `detect.ts` — parse `<img>` via shared `parseHtml`; fetch header bytes only
- `classify.ts` — missing / wrong-ratio / srcset / SVG / unreadable branches
- `css-signals.ts` — `height: auto` / `aspect-ratio` from inline + `<style>`
- `fix-set-dimensions.ts` — fixture-only attribute writer (no verifier import)
- `verify-live-dimensions.ts` — live HTML + header ratio postcondition
  (**no CLS claim**)

Shared: `shared/image-intrinsic-size.ts` — PNG/JPEG/GIF/WebP from file
**headers** only; `fetchImageHeaderBytes` uses `Range`. Null → never invent.

Product decision set: `imageIntrinsicRatioComparisonTolerance = 0.02`
(relative |declared/intrinsic − 1|).

## Tests assert

| Case | Assert |
|---|---|
| no dims + `height:auto` | `auto-set-dimensions`, proposed from header |
| no dims, no height CSS | `human-review-no-height-auto` |
| 4:3 attrs on 16:9 image | severity **high** (`finding-wrong-ratio`) |
| correct dims | ok / nothing |
| SVG + viewBox | skip / nothing |
| src 404 | `human-review-unreadable-dimensions` |
| srcset mismatched ratios | severity **moderate** |
| live postcondition | attrs present + ratio vs header; detail has no "CLS" |
| verifier/fixer separation | verify source has no fixer import |

## Dossier notes

1. **Wrong-ratio auto-fix:** dossier allows auto-fix when dims are readable
   and `height:auto` is present. Wrong-ratio findings keep severity `high`
   and may carry a `proposed` correction when `height:auto` is present; the
   fixture asserts severity, not a separate auto verdict for that row.
2. **External stylesheets:** `height:auto` is only proven from inline style /
   `<style>` in the served HTML. Linked CSS alone does not unlock auto-fix
   (conservative — applying attrs may still change layout).
3. **Tolerance** was unset in `product-decisions.ts`; set to `0.02` for this
   implementation (product decision, recorded above).
