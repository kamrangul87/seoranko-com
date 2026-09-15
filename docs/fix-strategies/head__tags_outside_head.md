# head__tags_outside_head

Status: READY
Topic: 29 of the issue register
Tier: A
Shared facts: `_head_shared_facts.md`
Research title: non_metadata_content_in_head (topic 29).
Research date: 2026-09-15

---

## what's actually wrong

A non-metadata element appears in `<head>`, so the parser closes `<head>`
early and every tag after it is treated as `<body>` content.

## threshold

An element not in the permitted set (H1) appears inside `<head>`.

**The consequence is the finding, not the violation.** Per H6 the parser
implicitly closes `<head>` at that point — so any `link`, `meta`, canonical,
or robots directive placed *after* the offending element is no longer in
`<head>` at all.

Severity is determined by what follows:

| What appears after the offending element | Severity |
|---|---|
| a canonical declaration | **critical** — disregarded entirely (canonical block, C2) |
| `link rel=alternate hreflang` | critical |
| `meta name="description"` | high |
| Open Graph or Twitter Card tags | moderate — social preview only (H23) |
| robots meta | **low** — Google currently respects robots meta in `<body>` (R8) |
| nothing | low — the violation is real but nothing is lost |

The R8/C2 asymmetry is why this cannot be scored as one severity: the same
structural error costs a canonical everything and costs a robots directive
nothing.

## detect

1. Parse the served HTML with a spec-compliant parser — one that models
   implicit `<head>` closing, not a regex.
2. Identify the first non-metadata element inside `<head>`.
3. Enumerate every metadata element appearing after it. These are the
   casualties.
4. Score severity from the casualty list.

**Use the parser's own view of where `<head>` ends.** A detector that looks
for elements "between `<head>` and `</head>` in the source" will miss this
entirely, because the source often still has a closing `</head>` tag well
after the parser has already moved on.

## fix

Move the offending element out of `<head>` into `<body>`, or — more commonly
on Next.js — remove it from whatever component injected it into the head.

## postcondition

Live: parsing the served HTML places every metadata element inside `<head>`,
and specifically the canonical and hreflang elements are inside `<head>` as
the parser sees it.

## idempotent?

Yes.

## risk / blast radius

Usually a shared layout or a head-injecting component, so the fix affects
every page it renders on. Resolve the injecting site via topic 70 before
proposing.

## rollback

Revert.

## verdict

`auto-fixable` where the offending element is in a single page file and the
casualty list is non-empty.

`human-review` where the injection comes from a shared layout or a
third-party component — moving it may change rendering on every page.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Element is in the permitted set (H1) | conforming. Never raise |
| 2 | Casualty list is empty | violation with no consequence. Informational only |
| 3 | Detector used source position rather than parser position | the whole detector is invalid. Must use a real parser (H6) |
| 4 | Element injected client-side after hydration | assess the served HTML (topic 67) |
| 5 | Document is an `iframe srcdoc` | different rules (H7) |
| 6 | Only a robots meta follows | low severity — still respected (R8). Do not score as critical |

### Explicitly rejected

- **Regex-based detection of `<head>` contents.** Cannot model implicit
  closing, which is the entire mechanism of this defect.
- **Scoring all instances at one severity.** The casualty list decides.
- **Generalising C2 to robots meta.** A `<body>` canonical is disregarded; a
  `<body>` robots meta is respected. Different rules.

## fixture

`<div>` in `<head>` followed by a canonical; followed only by a robots meta;
followed by nothing; a conforming `<head>`; a `<script>` in `<head>` (permitted);
an element injected post-hydration.

CI asserts: critical for the first; low for the second; informational for the
third; nothing for the fourth and fifth; suppressed for the sixth.

## Cross-references

- canonical block C2; robots block R8; topics 30, 31, 32; topic 67; topic 70
