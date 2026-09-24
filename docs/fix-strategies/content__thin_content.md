# content__thin_content

Status: READY — documented refusal
Topic: 60 of the issue register
Tier: C — reason 1 (no published criterion)
Shared facts: `_tier_c_shared_facts.md`
Research title: content__thin_content (topic 60).
Research date: 2026-09-15

---

## why there is no threshold

Google publishes self-assessment questions, not machine-checkable values (T1),
and the areas they cover — original analysis, substantial treatment, added
value, first-hand experience, a satisfying outcome (T2) — all require editorial
judgment (T4).

Worse for the obvious mechanical proxy: **Google names writing to arbitrary
word counts as a warning sign** (T3). So a word-count threshold is not merely
unsourced, it points the opposite way from Google's guidance.

There is also no postcondition. "This page is now substantial" cannot be
asserted against a served response.

## verdict

`not_mechanically_fixable`.

## what the product may report

Only observations with a stated method, never a quality judgement:

| Reportable | Basis |
|---|---|
| main-content word count as a **fact**, with no threshold attached | measurement |
| that a page's main content is empty or near-empty in the **served HTML** | topic 2a — this is a soft-404 signature, not a thin-content judgement |
| pre-hydration emptiness where content arrives client-side | topic 67 — a crawler artefact, not a content defect. With the render guard, judge the rendered DOM; raw-only thin signals become informational `RAW_RENDER_MISMATCH` |
| that the page is in "Crawled — currently not indexed" | topic 57 — reported as itself, never as evidence of thinness |

The second and third rows matter most: the autodun "thin content: 28 words"
finding was confirmed 2026-09-16 against a **complete** stream
(`streamComplete: true`, 2497 bytes, 28 words, 0 anchors) — dossier topic 67
step 3 (`client_only` shell), not a truncated prefix. Suppress as a crawler
artefact / client-only state; do not treat as a content defect.

## fix

None. Writing content is content generation, and no model authors content
applied to a customer repo. Even a human fix has no assertable postcondition.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Word count used as a quality threshold | unsourced, and T3 points the other way |
| 2 | Content arrives after hydration | topic 67. The served HTML being sparse is a crawler-side artefact |
| 3 | Page is intentionally short — a contact page, a login, a redirect stub | never a finding |
| 4 | Page is a soft 404 | topic 2a, and provable. Report that instead |
| 5 | "Crawled — currently not indexed" offered as evidence | T5-class inference. Rejected in topic 57 (B12) |
| 6 | A helpful/unhelpful verdict is emitted | T4 — these questions support human review only |
| 7 | Page is a listing, index or archive page | low text by design |

### Explicitly rejected

- **Any word-count threshold.**
- **An automated helpful/unhelpful finding.** T4.
- **Generating or expanding content.**
- **Using GSC indexing states as thinness evidence.**

## Cross-references

- topics 2a, 57, 67; topic 61 (different refusal reason)
