# Shared facts — canonical block (topics 13–18)

Cited by each dossier in the block. Added to `_sources.md` once, not six times.

Research date: 2026-09-15

## primary source

- RFC 6596, The Canonical Link Relation, April 2012 —
  https://www.rfc-editor.org/rfc/rfc6596.html
- Google, Canonicalization and how to specify a canonical URL —
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google, Canonicalization troubleshooting —
  https://developers.google.com/search/docs/crawling-indexing/canonicalization-troubleshooting
- Google, 5 common mistakes with rel=canonical (2013) —
  https://developers.google.com/search/blog/2013/04/5-common-mistakes-with-relcanonical
  **Carries an outdated-content warning. Claims from it are scoped, not stated flatly.**
- Google, Handling legitimate cross-domain content duplication (2009) —
  https://developers.google.com/search/blog/2009/12/handling-legitimate-cross-domain

## Verified facts

| # | Fact | Status |
|---|---|---|
| C1 | The canonical link relation is specified in RFC 6596; Google supports it | verified |
| C2 | The element must appear in `<head>`. Google disregards a canonical in `<body>` | verified |
| C3 | Absolute URLs are recommended; relative URLs are supported | verified |
| C4 | The canonical target's content must be duplicate, very similar, or a superset | verified |
| C5 | Google recommends a self-referential canonical on the preferred page | verified |
| C6 | Canonical is a **strong hint, not a command** | verified |
| C7 | An HTTP `Link` header is an alternative declaration method, used for non-HTML files; using both HTML and header is error-prone | verified |
| C8 | The target must exist — not a 404 or soft 404 | verified |
| C9 | The target must not carry `noindex` | verified |
| C10 | A canonical does not override the target's own status | verified |
| C11 | Google does not guarantee one precise outcome for an invalid canonical. The safe statement: it may ignore the canonical and select another URL by its own signals | verified |
| C12 | Where multiple `rel=canonical` declarations are present, Google will **likely** ignore all of them | scoped — source carries an outdated-content warning. "Likely", not "always" |
| C13 | Cross-domain canonical is permitted by RFC 6596 and documented as supported by Google | verified |
| C14 | Cross-domain use requires substantially duplicate content and one-to-one URL mapping | verified |
| C15 | For a domain migration Google prefers permanent redirects over cross-domain canonical | verified |
| C16 | Google's current troubleshooting guidance does not recommend canonical tags for syndicated content, because partner pages are often too different | verified |
| C17 | Canonical chains should be avoided; point directly at the final healthy URL | verified |

## Not adopted across the whole block

- **"Google ignores ALL canonical tags"** stated as fact. C12 is scoped.
- **Signal, ranking or link-equity transfer** claims. Not Google's vocabulary,
  no published figures.
- **The rationale that `<body>` canonicals are ignored to prevent script
  injection.** Invented; the docs state the behaviour, not a reason.

## Declaration sites in a Next.js repo

For every fix in this block, the canonical is declared at:

1. `metadata.alternates.canonical` — static export in `page.tsx`
2. the same field in any `layout.tsx` above the route
3. `generateMetadata()` — runtime, may be conditional → `indeterminate`
4. an HTTP `Link` header in `next.config` headers or middleware

Resolution uses the topic 70 site model. The fourth site is why topic 16
exists.
