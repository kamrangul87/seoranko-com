# content__lcp_cls_inp_metrics

Status: READY — documented refusal
Topic: 61 of the issue register
Tier: C — **reason 2** (published criterion, unassertable postcondition)
Shared facts: `_tier_c_shared_facts.md`
Research title: content__core_web_vitals_metrics (topic 61).
Research date: 2026-09-15

---

## why this is Tier C despite having exact thresholds

Core Web Vitals has precise published numbers: LCP ≤ 2.5 s, INP ≤ 200 ms,
CLS ≤ 0.1 (T17), passing at the 75th percentile of measured visits (T14, T18).
The threshold is not the problem.

**The postcondition is.** Assessment uses real-user field data from CrUX over
a rolling 28-day window (T12, T13), reported separately for mobile and desktop
(T15), and requires sufficient sample data (T16). So:

- a repo change cannot be verified against the metric in the same session
- changes appear only gradually, because older observations stay in the window
  (T19)
- the product cannot attribute a metric change to its own fix, since every
  other change in those 28 days is also in the data

That is a failure of the postcondition, not of the threshold — and it is why
the entire Tier A-minus block (topics 49–54) is forbidden from claiming metric
improvements.

## verdict

`not_mechanically_fixable` as a metric. The **markup-level causes** are
separate topics with real transforms: 49 (image dimensions), 50 (lazy loading
contradictions), 51 (unused preloads), 52 (`font-display`), 53 (caching).

## what the product may report

| Reportable | Basis |
|---|---|
| current CrUX values where available, with the 28-day window and percentile stated | T12–T15 |
| that CrUX data is **absent**, described as insufficient observations | **T21** |
| Tier A-minus markup findings that are plausible contributors, each as its own finding | topics 49–53 |

## fix

None at the metric level. Each markup cause has its own dossier, verdict and
postcondition.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Missing CrUX data reported as poor performance | **T21** — insufficient observations. The most common error here |
| 2 | Lighthouse score presented as the Core Web Vitals assessment | T20 — lab simulation, not field data |
| 3 | A metric improvement attributed to a specific fix | T19 — 28-day window, other changes included |
| 4 | Mobile and desktop conflated | reported separately (T15) |
| 5 | A single lab run treated as evidence of a change | T20 |
| 6 | Origin-level data presented as page-level | different aggregation |
| 7 | A fix's postcondition written as a metric value | forbidden across Tier A-minus |

### Explicitly rejected

- **Claiming a repo change improved LCP, CLS or INP.**
- **Treating absent CrUX data as failure.** T21.
- **Substituting Lighthouse for CrUX.** T20.
- **Any Tier A-minus postcondition expressed as a metric.**

## Cross-references

- topics 49–54 (the markup causes, and their metric prohibition); topic 62
