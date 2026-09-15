# Shared facts — hreflang block (topics 46–48)

Research date: 2026-09-15

## primary source

- Google, Tell Google about localized versions of your page —
  https://developers.google.com/search/docs/specialty/international/localized-versions

## Verified facts — declaration methods

| # | Fact | Status |
|---|---|---|
| G1 | Google supports HTML `<link rel="alternate">`, HTTP headers, and XML sitemaps **equally** | verified |
| G2 | Using one method consistently reduces conflicts | verified |
| G3 | Alternate URLs may cross domains but must be **fully qualified** | verified |
| G4 | Declaring different clusters across HTML, headers and sitemap is an error | verified |

**G1 is the detector's hardest constraint:** an annotation absent from HTML may
be present in a header or the sitemap. All three must be checked before
concluding anything is missing — the same trap as the canonical header in
topic 16.

## Verified facts — return links

| # | Fact | Status |
|---|---|---|
| G5 | Each localized version must reference **itself** and **every other version** in the declared cluster | verified |
| G6 | **"If two pages don't both point to each other, the tags will be ignored"** | verified |
| G7 | G6 applies to the **affected pair**, not necessarily the whole cluster. Google can still process other correctly reciprocal pairs | verified |
| G8 | Full all-to-all clusters are preferred, but large sites may maintain reciprocal links primarily between new variants and the dominant or original language | verified |

## Verified facts — code format

| # | Fact | Status |
|---|---|---|
| G9 | Format is `language` or `language-REGION` | verified |
| G10 | Language must be ISO 639-1 (`en`, `de`, `fr`) | verified |
| G11 | Region is optional, ISO 3166-1 Alpha-2 (`US`, `GB`, `CA`) | verified |
| G12 | **Region alone is invalid** — `US` without a language is an error | verified |
| G13 | `en-UK` is invalid; `en-GB` is correct | verified |
| G14 | Google does **not** support reserved region codes such as `EU`, `UN`, `UK`, and **ignores that portion** | verified |
| G15 | Google states **`es-419` is unsupported**, despite being a valid broader language-tag convention | verified |
| G16 | Google **does** support ISO 15924 script codes: `zh-Hant`, `zh-Hans`, `zh-Hans-US` | verified |

**G15 and G14 mean hreflang validation cannot reuse a generic BCP 47 grammar
check.** Google's accepted set is narrower than BCP 47. A validator built on
grammar alone will pass `es-419` and `en-UK`; one built on a hardcoded list
will fail `zh-Hans-US`. Both errors are real — the validator needs ISO 639-1
plus ISO 3166-1 Alpha-2 plus ISO 15924, minus Google's stated exclusions.

## Verified facts — x-default

| # | Fact | Status |
|---|---|---|
| G17 | `x-default` identifies the fallback URL where none of the declared languages or regions matches the user | verified |
| G18 | It may point to a language/country selector, a generic default-language page, or a redirecting or dynamically localized homepage | verified |
| G19 | **Recommended but not universally required** | verified |
| G20 | It does not represent a language and needs no accompanying language code | verified |

## Verified facts — interaction with other signals

| # | Fact | Status |
|---|---|---|
| G21 | hreflang helps Google select the appropriate localized URL but **does not determine page language** — Google determines language from visible content | verified (consistent with L6, topic 34) |
| G22 | Language variants should normally have canonical signals that preserve the localized pages. **Canonicalizing every translation to one language can defeat the cluster** | verified |
| G23 | Combining hreflang with attributes such as `media` in one alternate link is an error | verified |
| G24 | An annotation outside a well-formed `<head>` is an error | verified (see topic 29) |

## Not adopted

- **The "security mechanism" rationale for return links** — that reciprocity
  exists to stop third parties claiming localized status. Plausible but not
  stated in the documentation. The requirement (G6) is sourced; the reason is
  not.
- **Uppercase-or-lowercase region being equally correct.** G11 gives the
  Alpha-2 convention; case-insensitivity in matching is not the same as the
  convention, and the dossier should not encourage lowercase regions.
- **Any claim that hreflang influences ranking.** G21 scopes it to URL
  selection.
