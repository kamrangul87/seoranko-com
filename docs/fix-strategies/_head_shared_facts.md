# Shared facts — head integrity block (topics 29–34)

Research date: 2026-09-15

## primary source

- WHATWG HTML Standard, the `head` element —
  https://html.spec.whatwg.org/multipage/semantics.html#the-head-element
- Google, Influencing your title links in search results —
  https://developers.google.com/search/docs/appearance/title-link
- Google, Control your snippets in search results —
  https://developers.google.com/search/docs/appearance/snippet
- Open Graph protocol — https://ogp.me/

## Verified facts — HTML content model

| # | Fact | Status |
|---|---|---|
| H1 | `<head>` permits only metadata content: `base`, `link`, `meta`, `noscript`, `script`, `style`, `template`, `title` | verified |
| H2 | **Exactly one** `title` is required for ordinary documents | verified |
| H3 | No more than one `base` | verified |
| H4 | No more than one `meta name="description"`, matched case-insensitively | verified |
| H5 | Flow content (headings, paragraphs, divs) is **not permitted** in `<head>` | verified |
| H6 | A non-metadata element in `<head>` causes parsers to implicitly close `<head>`; everything after is treated as `<body>` | verified |
| H7 | `title` may be omitted for `iframe srcdoc` documents, or where the title comes from a higher-level protocol | verified |

## Verified facts — titles

| # | Fact | Status |
|---|---|---|
| H8 | Every indexable page should have a `<title>` | verified |
| H9 | **There is no fixed title-length limit.** Google truncates display based on device width | verified |
| H10 | `<title>` is an **input**, not a guaranteed SERP display value | verified |
| H11 | Google may generate the displayed title from: `<title>`, visible headings and prominent text, `og:title`, anchor text, inbound-link text, other page content, and `WebSite` structured data | verified |
| H12 | Titles should be descriptive, concise and distinct; avoid vague titles, keyword stuffing, repeated boilerplate and stale information | verified |
| H13 | Keep the title consistent with the primary visible heading and the page language | verified |

## Verified facts — descriptions

| # | Fact | Status |
|---|---|---|
| H14 | Google primarily generates snippets from page content, and uses `meta name="description"` where it describes the page better | verified |
| H15 | **There is no fixed description-length limit**; snippets are truncated as required | verified |
| H16 | Google may ignore the description and generate a query-specific snippet | verified |
| H17 | Avoid identical site-wide descriptions and keyword lists | verified |
| H18 | Programmatic descriptions are acceptable where human-readable and based on page-specific data | verified |

## Verified facts — Open Graph

| # | Fact | Status |
|---|---|---|
| H19 | Four properties are **required** by the protocol: `og:title`, `og:type`, `og:image`, `og:url` | verified |
| H20 | `og:description`, `og:site_name`, `og:locale` are optional | verified |
| H21 | Where `og:image` is present, `og:image:alt` should also be supplied | verified |
| H22 | Multiple values form arrays; **the first declaration has preference** on conflict — this is protocol-defined | verified |
| H23 | Missing Open Graph metadata is a social-preview issue, **not** by itself a Google indexing failure | verified |

## Verified facts — duplication

| # | Fact | Status |
|---|---|---|
| H24 | Google recommends unique titles and descriptions across distinct pages | verified |
| H25 | Repeated titles can cause Google to construct replacements from headings or prominent text | verified |
| H26 | Duplicate descriptions are described as unhelpful; Google may use page content instead | verified |
| H27 | **Google does not state that duplicate tags create a ranking penalty** | verified |
| H28 | Where URLs are genuinely duplicate variants, fix the URL duplication by redirect or canonicalization rather than generating artificial title differences | verified |
| H29 | Multiple `<title>` elements violate the WHATWG content model (H2) | verified |
| H30 | Google publishes **no dependable rule** for choosing among conflicting same-document descriptions — do not encode "first wins" as a Google threshold. This differs from Open Graph, where H22 is protocol-defined | verified |

## Not adopted across the whole block

- **Any character or pixel length limit for titles or descriptions.** H9 and
  H15 are explicit that no fixed limit is published. Figures like 50–60
  characters or 150–160 characters are third-party pixel measurements, not
  Google guidance, and must never appear as a threshold. A product may choose
  a display-truncation warning, but it is a product decision.
- **GSC flagging duplicate meta tags.** The HTML Improvements report was
  retired; no current report covers this.
- **Cannibalisation, split click-through, or reduced CTR claims.**
  Undocumented.
- **"First wins" for same-document duplicate descriptions.** See H30.
