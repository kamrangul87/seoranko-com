# content__eeat_authorship

Status: READY — documented refusal
Topic: 63 of the issue register
Tier: C — reason 1
Shared facts: `_tier_c_shared_facts.md`
Research title: content__eeat_and_authorship (topic 63).
Research date: 2026-09-15

---

## why there is no threshold

**Google states directly: "E-E-A-T itself isn't a specific ranking factor"**
(T5). It describes a mix of signals that may *align* with Experience,
Expertise, Authoritativeness and Trustworthiness (T6), with Trust the most
important element (T7) and greater attention for YMYL subjects (T8).

Quality raters do not control individual rankings (T9) and their ratings do
not directly feed ranking algorithms (T10); they evaluate whether
ranking-system changes produce helpful results (T11).

So an "E-E-A-T score" would be a metric Google says does not exist, presented
as if it did. That is the specific failure this dossier exists to prevent.

## verdict

`not_mechanically_fixable`.

## what the product may report

Only the presence or absence of **structural** authorship markup, which is
mechanical and lives in the structured-data block:

| Reportable | Basis |
|---|---|
| `author` absent from Article markup | topic 35 — and note it is *recommended*, not required (D7) |
| `author.name` polluted with job title, honorific or publisher | topic 35, D14 — deterministic fix |
| `author` typed as `Thing` rather than `Person`/`Organization` | topic 37, D15 |
| `author.url` or `sameAs` returning non-200 | topic 36 |

None of those is an E-E-A-T assessment. They are markup defects that happen to
involve authorship, and they are reported as markup defects.

## fix

None at this level. The markup items above have their own transforms.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | An E-E-A-T score is computed or displayed | **T5.** Never |
| 2 | Missing author markup framed as an E-E-A-T or trust problem | it is a markup finding (topic 35), and the property is recommended |
| 3 | Quality Rater Guidelines criteria implemented as checks | T9–T11 — raters do not affect rankings directly |
| 4 | YMYL classification applied automatically | topic classification is editorial |
| 5 | Author credentials assessed | not mechanical |
| 6 | Trust described as measurable | T7 names it as most important, not as a metric |

### Explicitly rejected

- **Any E-E-A-T score or grade.** T5.
- **Implementing QRG criteria as automated checks.** T9–T11.
- **Automatic YMYL classification.**
- **Framing recommended authorship markup as a trust defect.**

## Cross-references

- topics 35, 36, 37 (the mechanical authorship items); topic 60
