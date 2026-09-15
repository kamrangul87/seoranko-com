# performance__fonts_missing_font_display

Status: READY
Topic: 52 of the issue register
Tier: A-minus
Shared facts: `_performance_adjacent_shared_facts.md`
Research title: perf__font_display_absent (topic 52).
Research date: 2026-09-15

---

## what's actually wrong

An `@font-face` rule declares no `font-display`, leaving the loading strategy
to the browser.

## threshold

An `@font-face` block in same-origin CSS has no `font-display` descriptor.

**And that is not automatically a defect.** `auto` is a valid value and the
browser-selected strategy (P14) may be appropriate. There is no source stating
that omitting `font-display` is an error.

| Condition | Source | Severity |
|---|---|---|
| `@font-face` with no `font-display` | P14 | **low** — informational. `auto` is valid |
| invalid `font-display` value | P14–P18 | moderate — the descriptor is ignored |
| `font-display: swap` with no fallback metric matching | P19, P21 | low — a known layout-movement risk, reported not fixed |
| `font-display: optional` where the font is decorative | P20 | none. Valid choice |

**No CLS claim, in either direction.** `swap` improves text visibility and can
*cause* layout movement (P19); `optional` reduces movement but may never apply
the font (P20). There is no value that is universally better, so the agent
cannot recommend one as a fix.

## detect

1. Fetch same-origin stylesheets; parse `@font-face` blocks.
2. Record presence and value of `font-display`.
3. Validate the value against the five permitted keywords (P14–P18).
4. Where `swap` is used, record whether `size-adjust` or other metric-matching
   descriptors are present (P21).

## fix

- **invalid value** → deterministic correction only where the intent is
  unambiguous (a misspelling of a keyword). Otherwise removal, which restores
  `auto` behaviour.
- **absent `font-display`** → **no automatic fix.** Choosing between `swap`,
  `fallback`, `optional` and `auto` is a design trade-off between invisible
  text and layout movement (P19, P20). The agent reports the choice and its
  trade-off; it does not pick.

This is the honest outcome, and it differs from most tooling, which recommends
`swap` unconditionally. P19 is why that recommendation is not safe.

## postcondition

Where a fix is applied: every `font-display` descriptor in the served CSS is
one of the five permitted keywords.

## idempotent?

Yes.

## risk / blast radius

A global stylesheet — the change applies to every page using the font.
Changing the strategy changes what users see during load, which is a visible
design change, not a silent technical fix.

## rollback

Revert.

## verdict

`auto-fixable` only for correcting an unambiguously misspelled keyword.

`human-review` for choosing a strategy where none is set — and the finding is
framed as a choice to make, with the trade-off stated, not as a defect to
clear.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | `font-display` absent | `auto` is valid (P14). **Low severity only** |
| 2 | `font-display: optional` | valid choice (P20). Never raise |
| 3 | `swap` recommended as the fix | not safe (P19). Report the trade-off instead |
| 4 | Font is loaded from a third-party origin | the `@font-face` may not be editable. State the limitation |
| 5 | Font is loaded via JavaScript or the Font Loading API | `font-display` may not be the mechanism in use |
| 6 | Numeric timing thresholds used | not spec values. Never assert |
| 7 | A CLS improvement is claimed | not assertable, and `swap` may worsen it (P19) |
| 8 | `@font-face` for an icon font used decoratively | trade-offs differ; low severity |

### Explicitly rejected

- **Recommending `swap` as a default fix.** P19 — it can cause layout
  movement. The most common unsafe recommendation in this area.
- **Treating absent `font-display` as an error.** `auto` is valid.
- **Numeric block or swap period thresholds.** Not in the spec.
- **Any CLS claim.**

## fixture

`@font-face` with no `font-display`; with `font-display: swap` and no
`size-adjust`; with `font-display: optional`; with `font-display: swpa`
(misspelled); with `font-display: 3s` (invalid type); a third-party hosted
font.

CI asserts: low severity for the first and second; **nothing** for the third;
auto-fix for the fourth; moderate for the fifth; limitation stated for the
sixth. **No fixture asserts a recommended value.**

## Cross-references

- topics 49–51; topic 61 (CLS as a metric, Tier C)
