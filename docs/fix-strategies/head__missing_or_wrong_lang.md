# head__missing_or_wrong_lang

Status: READY — standards finding, no Search claim
Topic: 34 of the issue register
Tier: A
Shared facts: `_head_shared_facts.md`
Research title: language_declaration_missing_or_wrong (topic 34).
Research date: 2026-09-15

---

## what's actually wrong

The document declares no language, declares an invalid one, or its declared
language disagrees with its structured data.

## primary source

- WHATWG HTML Standard, the `lang` and `xml:lang` attributes —
  https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes
- Google, Managing multi-regional and multilingual sites —
  https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites
- schema.org, `inLanguage` — https://schema.org/inLanguage

### Verified facts

| # | Fact | Status |
|---|---|---|
| L1 | `lang` declares the primary language of an element's content and text attributes | verified |
| L2 | The value must be a valid BCP 47 language tag, or the empty string | verified |
| L3 | On `<html>` it establishes the document default, inherited by descendants | verified |
| L4 | Elements may override it (`<blockquote lang="fr">`) | verified |
| L5 | Browsers and assistive technology use it for pronunciation, fonts, hyphenation, spelling and form controls | verified |
| L6 | **Google states it does not use code-level language information such as `lang` attributes or the URL.** Page language is determined from visible content | verified |
| L7 | schema.org defines `inLanguage` as the language of the content, performance, or used in an action; expected value `Language` or `Text`, using a BCP 47 code | verified |
| L8 | `inLanguage` applies to `CreativeWork`, `Event`, `BroadcastService` and several action/role types, and describes the **entity**, not necessarily the whole document | verified |
| L9 | Google assigns Search behaviour to a property only where it is listed for a supported rich-result type. `inLanguage` is **not** listed as required or recommended for Article | verified |
| L10 | `inLanguage` **is** required for certain Book data, where Google asks for ISO 639-1 two-letter codes | verified |
| L11 | Neither `lang` nor `inLanguage` replaces `hreflang` for localized alternate URLs | verified |

## threshold

**No Search consequence may be claimed.** L6 is explicit. This is a standards
and accessibility finding, and the dossier says so plainly rather than
implying a ranking or indexing effect.

| Condition | Source | Severity |
|---|---|---|
| `<html>` has no `lang` attribute | L1, L3, L5 | moderate — accessibility |
| `lang` value is not a valid BCP 47 tag | L2 | high — invalid per spec, and assistive tech cannot use it |
| `lang` is present and valid but disagrees with the document's `inLanguage` | L7, L8 | low — metadata inconsistency |
| `inLanguage` absent on an Article or general page | L9 | **none.** Not required or recommended |
| `inLanguage` absent on Book data | L10 | high — required for that rich-result type |
| `inLanguage` present but not a valid BCP 47 code | L7 | moderate |
| `inLanguage` on Book data not in ISO 639-1 two-letter form | L10 | moderate |
| declared language disagrees with the visible content language | L6 | **see below** |

That last row is the one to be careful about. Determining the actual content
language requires language identification, which is a probabilistic
classifier, not a deterministic check. Under the hard filter that disqualifies
it as a threshold. It may be reported as a low-confidence observation with the
method named, never asserted and never auto-fixed.

## detect

1. Read the `lang` attribute on `<html>`. Validate against BCP 47 — structural
   validation of the tag grammar, not membership of a curated list.
2. Extract `inLanguage` from JSON-LD. Note the entity `@type` it sits on (L8)
   — an `inLanguage` on an embedded `Event` is not a document-level claim.
3. Compare where both exist.
4. For Book types, check presence and ISO 639-1 form (L10).

## fix

**Only from an authoritative source.** The correct language must be derived
from something the repo states — a route locale segment, an i18n
configuration, or stored page configuration. It is never guessed from a global
default and never inferred from the content.

- `lang` absent, route locale available → set it from the locale.
  Deterministic.
- `lang` invalid, route locale available → correct it. Deterministic.
- `lang` absent, no authoritative source → `human-review`. Adding
  `lang="en"` because English is common is a guess.
- `inLanguage` / `lang` disagreement → propose aligning to whichever the
  authoritative source supports; do not pick arbitrarily.
- Book `inLanguage` absent → scaffold from the authoritative source only.

## postcondition

Live: `<html>` carries a valid BCP 47 `lang` attribute, and where structured
data declares `inLanguage`, the two agree. Asserted against the served
response.

## idempotent?

Yes.

## risk / blast radius

`lang` is normally set in the root `layout.tsx`, so it is a **site-wide**
change. On a single-language site that is correct. On a site with localized
routes, a root-level `lang` may be deliberately overridden per route — check
before touching the root.

## rollback

Revert.

## verdict

`auto-fixable` where an authoritative locale source exists in the repo and the
value is absent or structurally invalid.

`human-review` where no authoritative source exists, where localized routes
are present, or for any content-language mismatch.

`not_mechanically_fixable` for detecting that the declared language is wrong
relative to the visible content.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | A Search or ranking consequence is claimed | not supported (L6). Reword the finding |
| 2 | `lang=""` (empty string) | **valid** per L2. Never raise |
| 3 | A descendant element overrides `lang` | permitted (L4). Never raise |
| 4 | `inLanguage` sits on an embedded entity rather than the page | not a document-level declaration (L8) |
| 5 | `inLanguage` absent on a non-Book type | not required (L9). Never raise |
| 6 | Site has localized routes with per-route `lang` | root-level value may be intentionally overridden |
| 7 | No authoritative locale source in the repo | never guess. Human-review |
| 8 | Language identified from content by a classifier | probabilistic. Report as an observation at most, never a finding |
| 9 | Missing `hreflang` | topics 46–48. `lang` does not substitute (L11) |
| 10 | Valid regional subtag Claude does not recognise (`en-GB`, `zh-Hant`, `pt-BR`) | validate BCP 47 grammar, not a hardcoded list |

### Explicitly rejected

- **Claiming any Google language-detection or ranking effect.** L6.
- **Defaulting to `lang="en"`.** A guess, and wrong on every non-English site.
- **Treating `lang=""` as missing.** Explicitly valid.
- **Validating against a hardcoded language list.** BCP 47 permits regional,
  script and variant subtags; a list will reject valid tags.
- **Auto-adding `inLanguage` to Articles.** Not required or recommended (L9).
- **Using `lang` or `inLanguage` as evidence of Google's detected language.**

## fixture

`<html>` with no `lang`; with `lang="en-GB"`; with `lang="english"` (invalid);
with `lang=""`; with `lang="en"` and `inLanguage: "fr"`; Book data with no
`inLanguage`; an Article with no `inLanguage`; a page with a nested
`<blockquote lang="fr">`; a repo with a route locale segment and no `lang`.

CI asserts: human-review for the first; nothing for the second, fourth,
seventh and eighth; high-severity finding for the third; low-severity
inconsistency for the fifth; high for the sixth; auto-fix for the ninth.

## Cross-references

- topics 46–48 hreflang (L11); topics 35–39 structured data; topic 70 for the
  locale source
