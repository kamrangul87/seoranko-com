# Topics 35, 36, 37, 39 — structured data

Branch: `cursor/structured-data-35-39-922c`
Date: 2026-09-17

## Built

**ONE extraction** — `extractStructuredData` (JSON-LD + Microdata + RDFa).
Parse failures recorded separately (malformed JSON-LD is not read). All four
topics classify from that object.

**Maintained tables** (each entry has `verifiedOn`; undated → no finding):

| Table | Module | Contents |
|---|---|---|
| Requirement (35) | `structured-data-requirement-table` | Article family (no required); BreadcrumbList (`itemListElement`) |
| Deprecation (39) | `structured-data-deprecation-table` | HowTo (Sep 2023); FAQPage (7 May 2026) |

| Topic | Key behaviour |
|---|---|
| 35 | Per-feature only. Article image/author/dates = recommended → never error. 50K pixel min (not 1200/800k). |
| 36 | Never raise on `@id`. Never remove required URL. Relative→absolutise; dead recommended→removable. |
| 37 | Valid-but-unsupported types never raised. No name→Person/Org inference. No non-trivial JSON-LD guess repairs. |
| 39 | Informational only; never auto-remove. FAQ without visible Q&A → D17 finding. |

## Tests assert

- Shared: one extraction feeds all four; tables dated; 50K pixels constant
- 35: Breadcrumb required absent; Article−image nothing; author cleanup/split auto; unknown type nothing; repo scaffold auto
- 36: Article image 404 moderate; relative/redirect auto; @id suppress; format; robots human-review
- 37: Artical→Article; Course nothing; Thing+repo Person auto; invalid prop review; context/trailing-comma auto; ambiguous parse review; @type array ok
- 39: FAQ/HowTo informational; Course nothing; FAQ−visible D17; undated entry suppressed

## Constraints checked

1. No global required list; Article has none
2. No 1200px / 800k — 50K width×height only
3. @id never raised; required URL never removed to “clear”
4. Valid unsupported types never raised; no non-trivial repair guesses
5. Entity kind only from repo
6. Deprecated = informational; never auto-remove; D17 for invisible FAQ
