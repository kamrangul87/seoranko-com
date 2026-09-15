# canonical__tag_absent

Status: READY
Topic: 13 of the issue register
Tier: A
Shared facts: `_canonical_shared_facts.md` (C1–C6)
Research date: 2026-09-15

---

## what's actually wrong

A page declares no canonical URL, in HTML or by header.

## threshold

**Absence alone is not a defect.** Google selects a canonical by its own
signals where none is declared (C11), and a canonical is a hint rather than a
requirement (C6). A site with no duplicates and no declared canonicals is not
broken.

The finding fires only when **duplicate URL forms for the page actually
exist** — proven by topics 8–12. Then the absence matters, because the site is
leaving the choice to Google while serving one piece of content at several
URLs.

Two severities:

- **duplicates proven to exist, no canonical declared** → finding
- **no duplicates found, no canonical declared** → informational at most.
  Google recommends a self-referential canonical (C5); not declaring one is
  not an error

## detect

1. Parse `<head>` for `link[rel=canonical]`. Check the HTTP `Link` header too.
2. A canonical found only in `<body>` counts as **absent** (C2) — and is its
   own reportable defect, since the author clearly intended one.
3. Cross-check against topics 8–12 output for proven duplicate forms.

## fix

Add a self-referential canonical at the correct declaration site (see shared
facts). Where duplicates exist, the canonical target is the preferred form
already derived by topic 8–12 — this topic does not re-derive it.

## postcondition

Live response `<head>` contains exactly one `link[rel=canonical]` with an
absolute URL, and the target returns 200.

## idempotent?

Yes.

## risk / blast radius

Page file for a single route. A `layout.tsx` declaration cascades to every
child page — **never add a canonical at layout level**, since a cascaded
canonical points many URLs at one target.

## rollback

Revert.

## verdict

`auto-fixable` for a self-referential canonical on a single page file where
duplicates are proven and the preferred form is already established.

`human-review` where the preferred form is unresolved, or where the fix would
land in a layout.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | No duplicate URL forms exist for the page | informational only. Never auto-fix |
| 2 | A canonical is declared by HTTP header | not absent. Topic 16 territory if HTML disagrees |
| 3 | `generateMetadata` may set it conditionally | `indeterminate`. Human-review |
| 4 | The page is deliberately excluded (`noindex`) | a canonical is not required. Do not raise |
| 5 | Route is `indeterminate` in the site model | cannot place the fix. Human-review |
| 6 | Non-HTML resource (PDF, image) | header declaration only; HTML fix does not apply |

### Explicitly rejected

- **Adding canonicals site-wide as a default improvement.** Absence is not a
  defect; this would be a change with no finding behind it.
- **Declaring the canonical in a layout.** Cascades wrongly.
- **Deriving the preferred form here.** That is topics 8–12's job.

## fixture

Page with duplicates and no canonical; page with no duplicates and no
canonical; page with canonical in `<body>` only; page with a header canonical;
page with conditional `generateMetadata`.

CI asserts: raised for the first; informational for the second; raised as
`<body>`-placement defect for the third; not raised for the fourth;
`indeterminate` for the fifth.

## Cross-references

- topics 8–12 supply the duplicate proof and preferred form
- topic 16 header-vs-HTML conflict; topic 17 multiple tags
- topic 29 tags outside `<head>`
