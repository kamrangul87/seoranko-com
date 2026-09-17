# structured-data__contradicts_visible_page

Status: READY — mostly report-only
Topic: 38 of the issue register
Tier: A (narrow slice) / C (the rest)
Shared facts: `_structured_data_shared_facts.md`
Research title: schema__contradicts_visible_page (topic 38).
Research date: 2026-09-15

---

## what's actually wrong

Structured data describes something other than what the page shows a reader.

## threshold

Google's policy is clear on the prohibition (D16–D22) but the assessment is
mostly judgement — and Google says so directly: a syntactically valid result
can still violate these policies, and **the Rich Results Test cannot reliably
detect quality or content mismatches** (D23). If Google's own tool cannot, this
product must not claim to.

So the topic splits.

### 38a — provable contradictions. Narrow, mechanical.

Each of these compares two machine-readable values, not markup against prose:

| Condition | Source | Rule |
|---|---|---|
| marked-up value contradicts the same value elsewhere in machine-readable form on the page — `datePublished` vs an `<time datetime>`, `offers.price` vs a `<meta itemprop="price">` | D17, D22 | both values are structured; comparison is exact |
| `dateModified` earlier than `datePublished` | D20 | internal logical contradiction |
| `datePublished` in the future | D20 | stale or wrong time-sensitive data |
| `aggregateRating` present with `reviewCount` of zero, or a rating outside its declared scale | D19 | internally inconsistent |
| marked-up entity `url` points to a different page than the one carrying the markup | D6 | structural |
| `Event` `endDate` before `startDate` | D20 | internal contradiction |
| item count in a `Carousel` or `ItemList` disagrees with the declared `numberOfItems` | D22 | both machine-readable |

**All of 38a compares structured values to structured values.** No prose
parsing, no semantic similarity, no judging whether content "represents" the
markup.

### 38b — everything else. Not provable.

Markup for content not visible to readers, irrelevant or misleading types,
fake reviews, misrepresented ownership or affiliation, omitted visible items.
These require reading the page as a human would.

**threshold:** none available. D23 is explicit.

**verdict:** `not_mechanically_fixable`. Report observations with the method
stated, never as a policy violation. The product does not accuse a site of a
spam-policy breach.

## detect

1. Extract structured data and every machine-readable counterpart on the page
   — `<time datetime>`, `itemprop` values, `<meta>` content, `data-*` where
   conventionally used.
2. Run only the 38a comparisons.
3. Assess the served HTML, not the hydrated DOM (topic 67).

## fix

- **internal contradictions** (date ordering, rating scale, item counts) →
  no automatic fix. Which value is correct is unknown; both are assertions by
  the site.
- **entity `url` mismatch** (D6) → deterministic where the markup should
  describe its own page.
- **structured-vs-structured value mismatch** → `human-review` with both
  values shown.

## postcondition

Where a human applies a fix: re-extraction from the live response shows the
two values agreeing, or the internal contradiction resolved.

## risk / blast radius

Generated markup across a type. A date-ordering bug is usually a generator
bug, not per-page data — worth saying so in the finding.

## verdict

`human-review` for all of 38a. `not_mechanically_fixable` for 38b.

Nothing here is auto-fixed: every case is two conflicting claims by the site,
and choosing between them is intent. An entity `url` pointing elsewhere may be
deliberate (syndication) — surface both values for human review; never rewrite
to self.

## reporting language

38b outputs describe an **observation**, never a violation: "the marked-up
rating has no corresponding visible reviews" rather than "this page violates
Google's structured data spam policy". The product observes; it does not
adjudicate. D23 is the reason.

Consequence language is also bounded by D24 and D25: loss of rich-result
eligibility, possible manual action, markup may be ignored — and the page can
still appear in Search. Claims of domain-wide suppression are not supported.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Comparison requires reading prose or judging representativeness | 38b. Never a finding |
| 2 | Visible value differs only in formatting (date display, currency symbol, thousands separator) | normalise before comparing; not a contradiction |
| 3 | Value is rendered client-side after hydration | assess served HTML (topic 67); a mismatch may be a rendering artefact |
| 4 | `dateModified` equals `datePublished` | valid. Never raise |
| 5 | Timezone differences between the markup and the visible date | normalise to UTC before comparing |
| 6 | Paywalled or subscription content deliberately marked up but not fully visible | permitted with paywalled-content markup. Never raise as hidden content |
| 7 | A spam-policy violation is asserted | reword as an observation (D23) |
| 8 | Domain-wide suppression is claimed | not supported (D24, D25) |

### Explicitly rejected

- **Claiming to detect content mismatch generally.** D23 — Google's own tool
  cannot.
- **Semantic similarity between markup and page text as a threshold.**
  Probabilistic.
- **Accusing a site of a spam-policy violation.** The product reports
  observations.
- **Auto-correcting either side of a contradiction.** Both are the site's
  claims.
- **Treating paywalled content as hidden markup.** Guard 6.

## fixture

`dateModified` before `datePublished`; `datePublished` in the future;
`aggregateRating` with `reviewCount: 0`; markup `url` pointing at another page;
a marked-up date differing from `<time datetime>` only by format; a marked-up
date differing in actual value; paywalled content marked up but not visible; a
page whose markup describes an unrelated subject.

CI asserts: human-review for the first, second, third, fourth and sixth;
human-review for the fourth's entity `url` with both the declared entity URL
and the page URL shown (never auto-fix — syndication may be deliberate);
nothing for the fifth and seventh; 38b observation only for the eighth.

## Cross-references

- topics 35, 36, 37, 39; topic 67; topic 2b (same "not provable" boundary)
