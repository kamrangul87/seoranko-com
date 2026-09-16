# content__render_blocking_scripts

Status: READY with research gap — documented refusal; dedicated research pass not run
Topic: 62 of the issue register
Tier: C — reason 2
Shared facts: `_tier_c_shared_facts.md`
Research title: content__render_blocking_resources (topic 62).
Research date: 2026-09-15

---

## why there is no transform

Two separate reasons, and both hold independently.

**The outcome is unassertable.** Whatever "render-blocking" costs is measured
in LCP and INP, which are CrUX field metrics over 28 days (T12–T19). Same
postcondition failure as topic 61.

**The transform is not deterministic.** Making a stylesheet or script
non-blocking means one of: deferring it, marking it `async`, inlining critical
CSS, or splitting a bundle. Each changes **execution order and timing**, any
of which can break the page — a deferred script that another inline script
depends on, or inlined CSS that goes stale against the stylesheet it was
extracted from. There is no mechanical way to prove the page still works
afterwards, and "the page still renders correctly" is not a machine-checkable
postcondition.

## verdict

`not_mechanically_fixable`.

## what the product may report

| Reportable | Basis |
|---|---|
| which same-origin stylesheets and scripts are in `<head>` without `async` or `defer` | measurement of the served HTML |
| that a resource is robots-blocked and needed for rendering | **topic 21** — provable, and a real finding |
| count and total transfer size of blocking resources, as facts | measurement |

The second row is the one with actual teeth, and it lives in topic 21.

## fix

None. Reported for human action.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | A blocking resource treated as a defect | no source says it is. Report as a measurement |
| 2 | An LCP or INP improvement claimed | T19, T21. Not assertable |
| 3 | `async` or `defer` proposed automatically | changes execution order; can break the page |
| 4 | Critical-CSS inlining proposed automatically | goes stale against the source stylesheet |
| 5 | Pre-hydration HTML assessed as the final render | topic 67 |
| 6 | Third-party resource | no repo transform |
| 7 | Reported as the cause of a CrUX value | correlation, not attribution |

### Explicitly rejected

- **Auto-adding `async` or `defer`.**
- **Auto-inlining critical CSS.**
- **Any metric claim.**
- **Treating blocking resources as a defect rather than a characteristic.**

## Open questions

This topic was **not the subject of a dedicated research pass.** The refusal
above rests on the Core Web Vitals facts and on the absence of a deterministic
transform, both of which are sound. A later pass should establish:

1. whether Google documents any *crawling or rendering* consequence of
   render-blocking resources, distinct from the user-performance one
2. whether WRS has a documented resource timeout that blocking resources could
   exhaust
3. whether `async`/`defer` correctness can be proven statically in any narrow
   case — a script with no inline dependents, for instance

Until then the verdict stands and no threshold is set.

## Cross-references

- topics 21 (the provable neighbour), 49–53, 61, 67
