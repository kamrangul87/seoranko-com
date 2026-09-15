# head__missing_meta_description

Status: READY — low severity by design
Topic: 31 of the issue register
Tier: A
Shared facts: `_head_shared_facts.md`
Research title: meta_description_missing (topic 31).
Research date: 2026-09-15

---

## what's actually wrong

Less than most tools claim. A page has no `meta name="description"`, or has
more than one.

## threshold

**A missing description is not a defect.** Google primarily generates snippets
from page content and uses the meta description only where it describes the
page better (H14), and may ignore it entirely in favour of a query-specific
snippet (H16). A page with no description is not broken.

The genuine structural finding:

| Condition | Source | Severity |
|---|---|---|
| more than one `meta name="description"` (case-insensitive) | H4 | high — non-conforming |
| description present but empty | H4 | moderate |
| no description at all | H14, H16 | **informational** |
| description identical site-wide | H17 | moderate — belongs to topic 33 |

**No length condition.** No fixed limit is published (H15). Same rule as topic
30: any character count is a product decision, never a threshold.

## detect

1. Parse with a real parser; take `<head>` as the parser sees it (topic 29).
2. Count `meta name="description"` elements, matching the name
   case-insensitively per H4.
3. Check for empty content.

## fix

- **more than one** → remove extras. Deterministic **only** where all values
  are identical. Where they differ, H30 applies: Google publishes no rule for
  which same-document description wins, so the agent cannot predict the
  current behaviour and must not guess which to keep. Propose, do not apply.
- **empty** → remove the element entirely, or scaffold a value for human
  approval. Removing an empty description is safe; it restores Google's
  default behaviour of generating from content.
- **missing** → no fix. Informational.

Writing description text is content generation and is not done by a model.
Where a value is proposed, it is drawn from the page's own content and requires
approval.

## postcondition

Live: at most one `meta name="description"`, non-empty if present, inside
`<head>` as the parser sees it.

## idempotent?

Yes.

## risk / blast radius

Frequently set in `layout.tsx`, which is exactly how a site ends up with one
identical description everywhere (H17) — that presents as topic 33.

## rollback

Revert.

## verdict

`auto-fixable` for removing identical duplicates and for removing an empty
element.

`human-review` for differing duplicates. No fix at all for absence.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | No description present | **not a defect** (H14, H16). Informational only |
| 2 | Description length outside a preferred range | not a defect (H15) |
| 3 | Google displays a different snippet | expected (H16). Never a finding |
| 4 | Duplicate values differ | H30 — no documented resolution. Never auto-pick |
| 5 | `name` attribute differs only in case | still a duplicate (H4, case-insensitive) |
| 6 | Description is programmatic but page-specific | explicitly acceptable (H18). Never raise |
| 7 | Page is `noindex` or non-200 | never raise |
| 8 | Element moved out of `<head>` by implicit closing | topic 29 |

### Explicitly rejected

- **Any character or pixel length threshold.** H15.
- **Treating absence as an error.** The most common false positive in this
  topic.
- **Generating description text with a language model.**
- **Applying "first wins" to conflicting descriptions.** H30 — that rule is
  Open Graph's (H22), not HTML's, and the two must not be conflated.
- **Flagging programmatic descriptions.** H18 permits them.

## fixture

Page with no description; with two identical descriptions; with two differing
descriptions; with `name="Description"` and `name="description"`; with an
empty description; with a programmatic page-specific description; with a
600-character description.

CI asserts: informational for the first; auto-fix for the second and fifth;
human-review for the third; duplicate detected for the fourth; nothing for
the sixth and seventh.

## Cross-references

- topic 29; topic 32 (H22 vs H30 distinction); topic 33; topic 70
