# canonical__multiple_tags

Status: READY
Topic: 17 of the issue register
Tier: A
Shared facts: `_canonical_shared_facts.md` (C2, C11, C12)
Research title: multiple_declarations (topic 17).
Research date: 2026-09-15

---

## what's actually wrong

One page carries more than one `rel="canonical"` element.

## threshold

Two or more `link[rel=canonical]` elements in the document.

**The consequence claim is scoped.** Google's statement that it will likely
ignore all canonical hints in this situation comes from a 2013 Search Central
article that now carries an outdated-content warning (C12). So the dossier
says *likely ignored*, never *always ignored*, and the finding rests on the
configuration being contradictory rather than on a guaranteed outcome.

Three distinct cases, distinguished mechanically:

| Case | Condition | Treatment |
|---|---|---|
| redundant | all declarations normalise to the same target | informational; safe to collapse |
| conflicting | two or more distinct normalised targets | finding |
| misplaced | a declaration sits in `<body>` | Google disregards it (C2); report as its own defect |

Normalisation follows topic 5's rules — slash, case, query and port stay
distinct.

## detect

1. Parse **all** `link[rel=canonical]` elements, in `<head>` and `<body>`.
2. Normalise targets, count distinct values.
3. Classify per the table.

Counting only the first element is the failure mode this detector exists to
avoid.

## fix

Collapse to one declaration.

- redundant → keep one, remove the rest. Deterministic.
- conflicting → the surviving target is intent. Propose, do not apply.
- misplaced → remove the `<body>` element; it has no effect anyway.

## postcondition

Live: exactly one `link[rel=canonical]` in the document, inside `<head>`.

## idempotent?

Yes.

## risk / blast radius

Commonly caused by two declaration sites both firing — a page-level
`metadata.alternates.canonical` plus a `layout.tsx` declaration, or a
component injecting one. Fixing the page without finding the second source
leaves the duplicate in place. Locate both sites via topic 70 before
proposing.

## rollback

Revert.

## verdict

`auto-fixable` for the redundant case and for removing a `<body>`
declaration — both are no-op changes to the served signal.

`human-review` for the conflicting case.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Declarations normalise to the same target | redundant. Not a conflict |
| 2 | Only one element exists in `<head>`, another in the header | topic 16, not this finding |
| 3 | Second declaration comes from a layout cascade | report both sites; fixing one is insufficient |
| 4 | Duplicate injected at runtime by client-side JS after hydration | assess the served HTML, not the hydrated DOM (topic 67) |
| 5 | Any target is non-200 or noindexed | topics 14, 15 alongside |

### Explicitly rejected

- **Stating that Google always ignores all canonicals here.** The source is
  outdated-flagged; the claim is "likely".
- **Keeping the first element by position.** Document order is not evidence of
  intent.
- **Fixing the page-level declaration without locating the second source.**

## fixture

Two canonicals with different targets; two with the same target; one in
`<head>` and one in `<body>`; a page-level plus a layout-level declaration;
one correct canonical.

CI asserts: human-review for the first; auto-fix for the second and third;
both sources reported for the fourth; suppressed for the fifth.

## Cross-references

- topic 13 absence; topic 16 header conflict; topic 29 tags outside `<head>`;
  topic 67 pre-hydration; topic 70
