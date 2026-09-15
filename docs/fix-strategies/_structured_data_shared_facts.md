# Shared facts — structured data block (topics 35–39)

Cited by each dossier in the block. Added to `_sources.md` once.
Requirement table: `_structured_data_requirement_table.md` (topic 35).
Deprecation table: `_structured_data_deprecation_table.md` (topic 39).

Research date: 2026-09-15
Article doc verified live, last updated 2026-09-08

## primary source

- Google, Structured data general guidelines —
  https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- Google, Article structured data —
  https://developers.google.com/search/docs/appearance/structured-data/article
- Google, Understand how structured data works —
  https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
- Google, HowTo and FAQ changes (Aug 2023) —
  https://developers.google.com/search/blog/2023/08/howto-faq-changes
- Google, Documentation updates — https://developers.google.com/search/updates
- schema.org

## Verified facts — required vs recommended

| # | Fact | Status |
|---|---|---|
| D1 | A missing **required** property makes the item ineligible for that rich-result type | verified |
| D2 | A missing **recommended** property leaves the item eligible, but may give a lower-quality or less complete result | verified |
| D3 | Valid markup **never guarantees** a rich result | verified |
| D4 | Requirements come from Google's page for the **specific Search feature**, not from schema.org. schema.org defines vocabulary, not Google eligibility | verified |
| D5 | Google supports JSON-LD (recommended), Microdata and RDFa | verified |
| D6 | Structured data must be on the page it describes | verified |

**D4 is the governing fact for this whole block.** There is no global list of
required properties. Each supported feature has its own, and they change.

## Verified facts — Article specifically

| # | Fact | Status |
|---|---|---|
| D7 | Google's Article documentation states **"There are no required properties"** — every Google-supported property for `Article`, `NewsArticle` and `BlogPosting` is *recommended* | verified live 2026-09-08 |
| D8 | Recommended properties are: `author`, `author.name`, `author.url`, `dateModified`, `datePublished`, `headline`, `image` | verified |
| D9 | `image` guidance: URLs must be crawlable and indexable; images must represent the marked-up content; format must be supported by Google Images | verified |
| D10 | For best results Google recommends multiple high-resolution images, **minimum 50K pixels when multiplying width by height**, in 16x9, 4x3 and 1x1 aspect ratios | verified |
| D11 | Article markup is **not required** for eligibility in Google News features such as Top stories | verified |
| D12 | For multi-part articles, `rel=canonical` should point at each individual page or a view-all page, never at page 1 of a series | verified |
| D13 | Multiple authors must each have their own `author` field; do not merge names into one field | verified |
| D14 | `author.name` must contain only the name — not the publisher, job title, honorific, or introductory words | verified |
| D15 | Use `Person` for people and `Organization` for organizations; do not use `Thing` or the wrong type | verified |

**Not adopted: the "1200 pixels wide" or "800,000 total pixels" figure.** These
are stale former requirements. D10 is the current figure, verified live.
Any dossier or code carrying the old number must be corrected.

## Verified facts — content match and spam policy

| # | Fact | Status |
|---|---|---|
| D16 | Structured data must accurately represent visible page content and the page's primary subject | verified |
| D17 | Prohibited: marking up content not visible to readers | verified |
| D18 | Prohibited: irrelevant or misleading types and properties | verified |
| D19 | Prohibited: fake reviews or ratings | verified |
| D20 | Prohibited: stale time-sensitive data | verified |
| D21 | Prohibited: misrepresenting ownership, affiliation or purpose | verified |
| D22 | Prohibited: omitting visible items in ways that make markup misleading | verified |
| D23 | A syntactically valid result can still violate these policies. **The Rich Results Test cannot reliably detect quality or content mismatches** | verified |
| D24 | Consequences: loss of rich-result eligibility, possible structured-data manual action, and the markup may be ignored | verified |
| D25 | Where a structured-data manual action applies, the markup is ignored **but the page can still appear in Google Search results**. Google states the manual action itself does not affect ordinary web ranking | verified |

## Verified facts — deprecations

| # | Fact | Status |
|---|---|---|
| D26 | **HowTo: deprecated.** Google stopped showing HowTo rich results on mobile and desktop in September 2023. Documentation, Rich Results Test support and Search Console reporting were removed | verified |
| D27 | **FAQPage: fully deprecated.** Google stopped showing FAQ rich results on 7 May 2026, including the previous exception for authoritative government and health sites. Documentation was removed in June 2026 | verified |
| D28 | Valid FAQ and HowTo schema.org markup may remain for other consumers, but has no Google Search rich-result effect | verified |
| D29 | Google has previously stated unused structured data does not cause Search problems — but it provides no Google Search benefit either | verified |

## Not adopted across the whole block

- **"1200px wide" / "800,000 pixels" for Article images.** Stale. See D10.
- **`image` being required for Article.** D7 — there are no required
  properties.
- **Article markup being required for Top stories.** D11.
- **Algorithmic suppression "across the entire domain" from a mismatch.** Not
  documented; D24 and D25 describe the actual consequences.
- **Any claim that leaving FAQ or HowTo markup in place is penalised.** D28,
  D29 — it is inert, not punished.
