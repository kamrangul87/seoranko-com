# head__missing_or_malformed_title

Status: READY
Topic: 30 of the issue register
Tier: A
Shared facts: `_head_shared_facts.md`
Research title: title_missing_or_malformed (topic 30).
Research date: 2026-09-15

---

## what's actually wrong

An indexable page has no `<title>`, more than one, or an empty one.

## threshold

Three structural conditions, all from the spec, all binary:

| Condition | Source | Severity |
|---|---|---|
| no `title` element on an indexable page | H2, H8 | high |
| more than one `title` element | H2, H29 | high — non-conforming |
| `title` present but empty or whitespace-only | H2, H8 | high |

**No length condition.** Google publishes no fixed title-length limit (H9). A
character count is not a threshold and must not be presented as one.

If the product wants to warn about display truncation, that is a **product
decision** with its own label — never sourced to Google, never called a
defect, and never auto-fixed.

Also not a defect in itself: a title Google chose to rewrite. `<title>` is an
input, not a guaranteed display value (H10), and Google may generate the
displayed title from eight different sources (H11). A mismatch between your
title and the SERP is expected behaviour.

## detect

1. Parse the served HTML with a real parser — and take `<head>` as the parser
   sees it, since topic 29's implicit closing can move a `title` out of scope.
2. Count `title` elements; check for empty or whitespace-only content.
3. Confirm the page is indexable before raising: 200, no `noindex`,
   self-canonical. A `noindex` page with no title is not a finding.

## fix

**Adding a title requires generating content, which the agent does not do.**
No language model writes the title.

What is deterministic:

- **more than one `title`** → remove the extras, keeping one. The kept element
  is the survivor only where the duplicates are identical; differing titles
  are intent, so propose and do not apply
- **missing or empty `title`** → scaffold only. Propose the element with the
  page's primary visible heading as a candidate value, drawn from the page
  itself, and require human approval. H13 supports consistency with the
  primary heading, which makes the heading a defensible candidate source —
  but it is a proposal, not a fix

## postcondition

Live: exactly one non-empty `title` element, inside `<head>` as the parser
sees it.

## idempotent?

Yes.

## risk / blast radius

A `title` set in `layout.tsx` applies to every child page that does not
override it, so a layout-level title is a likely cause of topic 33
(duplicates). Report the declaration site.

## rollback

Revert.

## verdict

`auto-fixable` only for removing identical duplicate `title` elements.

`human-review` for missing, empty, or differing-duplicate titles — every one
of those requires deciding what the title should say.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Page is `noindex` or non-200 | not an indexable page. Never raise |
| 2 | Title length outside some preferred range | **not a defect** (H9). Never raise as one |
| 3 | SERP shows a different title than the source | expected (H10, H11). Never a finding |
| 4 | `title` moved out of `<head>` by implicit closing | topic 29 is the cause. Fix that first |
| 5 | Document is `iframe srcdoc` or takes its title from a higher-level protocol | `title` may be omitted (H7) |
| 6 | Title set via `generateMetadata` conditionally | `indeterminate` |
| 7 | Title is present but templated identically across pages | topic 33, not this finding |

### Explicitly rejected

- **Any character or pixel length threshold.** H9. This is the single most
  common false threshold in SEO tooling.
- **Generating title text with a language model.** Violates the core
  constraint; no model authors content applied to a customer repo.
- **Treating a Google-rewritten title as an error.**
- **Auto-removing one of two differing titles.** Which one is intended is
  intent.

## fixture

Page with no `title`; with two identical titles; with two differing titles;
with an empty `title`; with a 200-character title; a `noindex` page with no
title; a page whose `title` follows a `<div>` in `<head>`.

CI asserts: human-review scaffold for the first and fourth; auto-fix for the
second; human-review for the third; **nothing** for the fifth; suppressed for
the sixth; routed to topic 29 for the seventh.

## Cross-references

- topic 29 implicit closing; topic 33 duplicates across URLs; topic 70
