# content__search_intent_mismatch

Status: READY — documented refusal
Topic: 64 of the issue register
Tier: C — reason 1
Shared facts: `_tier_c_shared_facts.md`
Research title: content__search_intent_mismatch (topic 64).
Research date: 2026-09-15

---

## why there is no threshold

Judging whether a page satisfies the intent behind a query requires knowing
what the searcher wanted — which is not a property of the page, the response,
or the repo.

Google's nearest guidance is the self-assessment set (T1, T2): does the page
leave the reader with a useful, satisfying outcome. Explicitly editorial
questions, explicitly for human review (T4).

There is no published criterion and no assertable postcondition. Nothing in a
served response proves intent was met.

## verdict

`not_mechanically_fixable`.

## what the product may report

Two mechanical observations that are sometimes *called* intent problems but
are actually their own findings:

| Reportable | Basis |
|---|---|
| a page's `<title>` inconsistent with its primary visible heading | topic 30, H13 — Google recommends consistency |
| a page ranking for queries with impressions but no clicks | GSC measurement, reported as a fact with the date range, **never** as an intent diagnosis (B22, B26) |

The second row is where tools overreach. Impressions without clicks is a
number, not a cause.

## fix

None.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Query intent classified automatically (informational/transactional/navigational) | not mechanical; no published criterion |
| 2 | Low click-through reported as intent mismatch | correlation. Report the number only |
| 3 | Content compared to competitor pages for intent | judgement, and competitor content is not the site's to change |
| 4 | A page type inferred from the URL and judged against it | inference |
| 5 | GSC impressions absent | B22 — absence is not zero |
| 6 | An intent verdict emitted | T4 |

### Explicitly rejected

- **Automatic intent classification.**
- **Treating low CTR as a diagnosis.**
- **Any competitor-content comparison as a finding.**

## Cross-references

- topics 30, 57, 59, 60
