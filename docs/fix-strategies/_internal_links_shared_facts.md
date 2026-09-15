# Shared facts — internal links block (topics 41–45)

Research date: 2026-09-15

## primary source

- Google, Make your links crawlable —
  https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- Google, Learn about sitemaps —
  https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- Google, Canonicalization —
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google, Move a site with URL changes —
  https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes

## Verified facts — crawlable links

| # | Fact | Status |
|---|---|---|
| N1 | **Google can only crawl a link if it is an `<a>` element with an `href` attribute** | verified |
| N2 | Crawlable forms include absolute, root-relative and dot-relative `href` values | verified |
| N3 | Unreliable: `onclick` without a valid `href`, a non-anchor element carrying `href`, and `href="javascript:…"` | verified |
| N4 | JavaScript-generated links **are** crawlable where the rendered result is a normal `<a href="…">` | verified |
| N5 | The `href` must resolve to a requestable URI | verified |
| N6 | Anchor text should be descriptive and placed inside the anchor; image links use the image's `alt` text | verified |

## Verified facts — orphan pages

| # | Fact | Status |
|---|---|---|
| N7 | Google's recommendation: **every page you care about should have a link from at least one other page on your site** | verified |
| N8 | Zero internal links does **not** prove Google cannot discover the URL. Discovery may also come from XML sitemaps, external links, previously crawled URLs, and redirects | verified |
| N9 | A sitemap aids discovery but does not replace internal architecture and does not guarantee crawling or indexing | verified |

N8 is the boundary of the claim. "Orphaned in the site link graph" is
provable. "Google cannot discover or index this page" is not.

## Verified facts — crawl depth

| # | Fact | Status |
|---|---|---|
| N10 | **Google publishes no numeric maximum click-depth threshold for indexing** | verified |
| N11 | An older official article recommends keeping important pages within "several clicks" of the home page — **no number is given** | verified |
| N12 | Current guidance: important pages should be reachable through navigation and links starting from the homepage | verified |

## Verified facts — links through redirects

| # | Fact | Status |
|---|---|---|
| N13 | **When linking within your site, link to the canonical URL rather than a duplicate URL** | verified |
| N14 | For site moves, Google says to update internal links from old URLs to new URLs, and to redirect directly to the final destination | verified |
| N15 | Googlebot supports up to 10 redirect hops, but Google recommends the direct destination where possible, **ideally no more than 3** redirects where chaining is unavoidable, and **fewer than 5** | verified |

N15 refines topic 4: Google does give soft chain numbers, even though the hard
limit is 10. Topic 4's quality-finding threshold should cite 3 and 5 rather
than treating everything from 2 to 10 as equivalent.

## Not adopted across the whole block

- **Any click-depth table mapping click count to crawl frequency or indexing
  behaviour.** N10 — no such thresholds are published. A table claiming
  "0–2 clicks: very high priority, 5+ clicks: at risk of de-indexing" is
  fabricated. This is the single most dangerous unsourced artefact
  encountered in this research, because it looks precise enough to hardcode.
- **PageRank claims.** "Internal PageRank signals", "PageRank distribution",
  "301 transfers most PageRank", "dilutes signal clarity". Not Google's
  current vocabulary and not published as measurable.
- **Crawl-budget waste as a harm claim** for internal links through
  redirects.
- **"Orphan pages rarely rank for competitive queries."** Unsourced.
- **"Google measures page importance using click depth."** Not a documented
  statement.
- **The Indexing API as a general discovery mechanism.** It is limited to
  specific content types; not a general orphan-page remedy.
