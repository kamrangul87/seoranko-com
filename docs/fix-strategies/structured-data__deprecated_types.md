# structured-data__deprecated_types

Status: READY — informational, and deliberately so
Topic: 39 of the issue register
Tier: A
Shared facts: `_structured_data_shared_facts.md`
Research title: schema__deprecated_types_still_emitted (topic 39).
Research date: 2026-09-15

---

## what's actually wrong

The site emits structured data for a rich-result type Google no longer
displays. The markup is inert, not harmful.

## threshold

A type is present whose Google rich-result support has been withdrawn.

Verified deprecations:

| Type | Withdrawn | Source |
|---|---|---|
| `HowTo` | Rich results stopped on mobile and desktop September 2023. Documentation, Rich Results Test support and Search Console reporting all removed | D26 |
| `FAQPage` | Rich results stopped **7 May 2026**, including the former exception for authoritative government and health sites. Documentation removed June 2026 | D27 |

**Severity: informational.** The markup remains valid schema.org vocabulary
and may serve other consumers (D28). Google has stated unused structured data
does not cause Search problems, though it confers no Search benefit either
(D29). There is no penalty for leaving it in place, and the dossier must not
imply one.

The finding's value is honesty, not repair: the site owner may believe FAQ
markup is producing rich results when it has not since May 2026. Telling them
is useful. Removing it for them is not necessary.

## detect

1. Extract structured data; collect all `@type` values.
2. Compare against a **deprecation table** in the repo: type, date withdrawn,
   source URL, date verified.
3. Report presence as informational with the withdrawal date.

The deprecation table is the whole mechanism, and it is the part most likely
to go stale. Every entry carries a verified-on date, and the table is reviewed
against Google's documentation-updates feed rather than assumed stable.

## fix

**Optional removal only, and only on request.** Removing deprecated markup:

- changes nothing Google displays (D26, D27)
- may break other consumers relying on the vocabulary (D28)
- is not required by any guideline

So there is no fix the agent proposes on its own initiative. Where the user
asks for cleanup, removal is deterministic.

What the agent should surface instead: if the site has FAQ content in markup
only and not in visible page content, that is a separate and more useful
finding — D17 prohibits marking up content not visible to readers, and the
former FAQ-rich-result incentive is exactly why such pages exist.

## postcondition

Where removal is requested: re-extraction from the live response shows no
instances of the deprecated type.

## idempotent?

Yes.

## risk / blast radius

Generated markup across a template. Removal is low risk for Google and
non-zero risk for other consumers — which is why it is not proposed
unprompted.

## rollback

Revert.

## verdict

`informational`. Not a defect. Removal is `auto-fixable` on explicit request
only.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | A penalty or harm from the deprecated markup is claimed | not supported (D28, D29). Reword |
| 2 | Type is valid schema.org but was never a Google rich-result type | not a deprecation. Never raise |
| 3 | Deprecation table entry has no verified-on date | unusable. Do not raise from an undated entry |
| 4 | Deprecation table is older than Google's latest documentation update | re-verify before raising |
| 5 | Site declares it targets non-Google consumers | informational at most; removal is against its interest (D28) |
| 6 | FAQ content exists in markup but not on the visible page | raise the D17 finding instead — that is the substantive issue |
| 7 | Removal proposed without the user asking | do not. No guideline requires it |

### Explicitly rejected

- **Claiming FAQ or HowTo markup is penalised.** D28, D29 — inert, not
  punished. This is the most common stale claim in current SEO advice.
- **Auto-removing deprecated markup.** It may serve other consumers.
- **Treating deprecation as a defect.** It is a change in Google's display
  behaviour, not a site error.
- **Relying on any deprecation list without dates.** The withdrawal dates
  above are the whole content of the finding; an undated list cannot support
  it.

## Open questions

1. The deprecation table needs a maintenance cadence tied to Google's
   documentation-updates feed. Which other types have had rich-result support
   withdrawn is not fully enumerated by this research pass — only `HowTo` and
   `FAQPage` are verified.

## fixture

A page emitting `FAQPage`; emitting `HowTo`; emitting `Course` (supported); a
page emitting `FAQPage` where the Q&A content is not visible on the page; a
deprecation table entry with no verified-on date.

CI asserts: informational for the first and second; nothing for the third; the
D17 visible-content finding for the fourth; no finding raised from the fifth.

## Cross-references

- topics 35, 37, 38 (D17 overlap); the deprecation table is a maintained
  artefact like the requirement table in topic 35
