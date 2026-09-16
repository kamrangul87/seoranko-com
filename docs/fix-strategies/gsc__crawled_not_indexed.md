# gsc__crawled_not_indexed

Status: READY — report-only, and deliberately uninformative
Topic: 57 of the issue register
Tier: B — connection-required
Shared facts: `_gsc_shared_facts.md`
Research title: gsc__crawled_not_indexed (topic 57).
Research date: 2026-09-15

---

## what's actually wrong

Unknown, and the dossier's main job is to say so.

## threshold

GSC reports "Crawled — currently not indexed": the page was crawled but not
indexed, may or may not be indexed later, and there is no need to resubmit it
(B11).

**Google does not publish the classifier or threshold for this state** (B12).
That single fact determines everything below.

So the state must **not** be translated into:

- thin content
- duplicate content
- low quality
- low user value
- a ranking or quality failure

Any of those is an inference the product cannot support, and B12 is the
reason. This is the most common unsourced inference in the entire register,
and it is what most tools output.

What the agent can legitimately report:

| Reportable | Basis |
|---|---|
| the state itself, with Google's own definition and the crawl date | B11, B5 |
| that Google says no resubmission is needed | B11 |
| any **independently detected** mechanical defect on the same URL | the other dossiers |

That third row is where the value is. If the page is also a 2a soft 404, or
canonicalises elsewhere, or carries conflicting directives, those are provable
findings with their own evidence — and they may well be relevant. But they are
reported as themselves, not as explanations of this state.

## detect

1. Query the state per URL (B14–B18), respecting the cap.
2. Cross-reference the URL against every finding already produced by topics
   1–54 for that page.
3. Report the state, plus any independently proven findings, plus the crawl
   date.

## fix

**None.** There is no transform, because there is no known cause. B11 says no
resubmission is needed, which removes even the usual reflex action.

Where independent findings exist on the same URL, they carry their own fixes
and verdicts. Fixing them may or may not change this state; that is not
claimed.

## postcondition

n/a — no transform. Any re-query after unrelated fixes is a measurement, not
a postcondition.

## verdict

`connection-required`, `not_mechanically_fixable`, report-only.

No GSC connection → silent.

## reporting language

The output states what Google says and nothing more: "Google crawled this page
and has not indexed it. Google does not publish why, and says no resubmission
is needed." Then, separately, any independently detected defects.

Wording that implies the product knows the cause is a rejected framing — it
would be presenting a guess as a diagnosis, which is precisely what this
product exists not to do.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | State translated into thin or duplicate content | **B12.** Never. No published classifier |
| 2 | State translated into a quality judgement | B12. Never |
| 3 | Word count or content length offered as the cause | inference; also topic 60 is `not_mechanically_fixable` |
| 4 | Reported as a current condition | historical (B5) |
| 5 | Resubmission recommended | B11 says it is not needed |
| 6 | An independently proven finding presented as the *explanation* of this state | report it as its own finding, not as a cause |
| 7 | No GSC connection | silent |
| 8 | Coverage partial under the cap | state it (B18) |

### Explicitly rejected

- **"This means thin content."** B12. The single most important rejection in
  this block.
- **"This means duplicate content."** B12.
- **Any quality or value judgement derived from the state.**
- **Recommending resubmission.** B11.
- **Presenting a correlated finding as the cause.**

## fixture

A URL in this state with no other findings; in this state and also a proven 2a
soft 404; in this state with 40 words of content; in this state and
canonicalising elsewhere; no GSC connection.

CI asserts: state reported with **no cause inferred** for the first; the 2a
finding reported **separately** for the second; **no thin-content claim** for
the third; the canonical finding reported separately for the fourth; silent
for the fifth.

## Cross-references

- topics 2a, 56, 60 (which is itself `not_mechanically_fixable`); all of
  1–54 as independent corroboration
