# head__duplicate_titles_descriptions

Status: READY
Topic: 33 of the issue register
Tier: A
Shared facts: `_head_shared_facts.md`
Research title: duplicate_titles_and_descriptions (topic 33).
Research date: 2026-09-15

---

## what's actually wrong

Distinct pages share the same `<title>` or the same `meta name="description"`.

## threshold

Identical title or description values across two or more URLs that are **not**
duplicate variants of each other.

That last clause is the whole finding, and it comes from H28: where the URLs
are genuinely duplicate variants, the defect is the URL duplication, not the
shared title. Fix it by redirect or canonicalization — **never by generating
artificial title differences.**

So the detector must first exclude:

- trailing-slash, protocol, host and case variants (topics 8–11)
- parameterised variants of the same page (topic 12)
- URLs canonicalising to one another (topics 13–18)

What remains — genuinely distinct pages with identical metadata — is the
finding.

| Condition | Source | Severity |
|---|---|---|
| identical `title` across distinct pages | H24, H25 | moderate |
| identical `description` across distinct pages | H24, H26 | low |
| identical description site-wide | H17 | moderate |
| boilerplate-only titles (brand name alone, repeated) | H12 | moderate |

**No ranking claim.** Google does not state that duplicate tags create a
penalty (H27). The documented consequence is that Google may construct a
replacement from headings or prominent text (H25) or use page content instead
of the description (H26). That is the honest framing: the site is forfeiting
control of its own snippet, not incurring a penalty.

## detect

1. Collect `title` and `description` per crawled indexable URL.
2. Normalise for comparison: trim whitespace, collapse internal runs. Do
   **not** case-fold — a title differing only in case is still a distinct
   string and the difference may be intentional.
3. Group by identical value.
4. **Exclude groups whose members are duplicate URL variants of each other**
   per topics 8–18. This is the mandatory step.
5. Remaining groups of size ≥ 2 → finding, with every member listed.

## fix

**None applied.** Writing distinct titles and descriptions is content
generation, and no model authors content applied to a customer repo.

Two things the agent does contribute, both mechanical and both valuable:

- **Identify the declaration site.** An identical title across many pages is
  almost always one `layout.tsx` or metadata helper, not many page files.
  Naming that single source turns a hundred findings into one fix. Resolve via
  topic 70.
- **Route duplicate-variant groups to the correct topic.** Where the shared
  title is a symptom of URL duplication, the finding belongs to topics 8–12
  and the title is not touched at all (H28).

## postcondition

Where a human applies content: each URL in the group serves a distinct
non-empty `title`. Asserted per URL against the live response.

## risk / blast radius

The fix is usually in one shared file. Changing a layout-level title affects
every page inheriting it — which is the point, but it means the change is
site-wide, not per-page.

## verdict

`not_mechanically_fixable` for the content. `auto-detectable` for the
duplication, and `auto-resolvable` for identifying the single declaration
site.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Group members are duplicate URL variants | route to topics 8–12. **Never** propose title changes (H28) |
| 2 | Group members canonicalise to one another | route to topics 13–18 |
| 3 | Paginated pages sharing a title | often legitimate. Never auto-raise |
| 4 | Normalisation case-folded the values | do not case-fold; the difference may be intended |
| 5 | Pages are `noindex` or non-200 | exclude from grouping |
| 6 | Titles differ only by a shared brand suffix | not identical. Not this finding |
| 7 | A ranking penalty is claimed | not supported (H27) |
| 8 | Title identical because Google rewrote it in the SERP | assess the served `<title>`, not the SERP (H10) |

### Explicitly rejected

- **Generating distinct titles or descriptions with a language model.**
- **Proposing title differences for duplicate URL variants.** H28 is explicit
  — fix the URLs instead. Generating artificial differences would make the
  duplicate-URL problem harder to detect later.
- **Claiming a ranking penalty, cannibalisation, or split click-through.**
  Undocumented.
- **Reporting one finding per affected page** where a single layout is the
  cause. Report the declaration site once.

## fixture

Two distinct pages with identical titles; `/page` and `/page/` with identical
titles; two pages canonicalising to one another; paginated pages sharing a
title; twenty pages inheriting one layout title; two titles differing only by
a brand suffix; a `noindex` page sharing a title.

CI asserts: finding for the first; routed to topic 8 for the second; routed to
the canonical block for the third; suppressed for the fourth; **one** finding
naming the layout for the fifth; nothing for the sixth and seventh.

## Cross-references

- topics 8–12 URL duplication (H28); topics 13–18 canonical; topics 30, 31;
  topic 70
