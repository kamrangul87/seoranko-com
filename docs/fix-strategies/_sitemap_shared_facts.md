# Shared facts — sitemap block (topics 24–28)

Research date: 2026-09-15

## primary source

- Sitemaps.org protocol — https://www.sitemaps.org/protocol.html
- Google, Build and submit a sitemap —
  https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google, Manage large sitemaps —
  https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps
- RFC 9309 (for the `Sitemap:` record's status) —
  https://www.rfc-editor.org/rfc/rfc9309.html

## Verified facts — protocol

| # | Fact | Status |
|---|---|---|
| S1 | UTF-8 XML with entity-escaped values | verified |
| S2 | Required elements: `urlset` root, one `url` per entry, one `loc` per `url` | verified |
| S3 | `loc` must be absolute, protocol-qualified, and **under 2,048 characters** | verified |
| S4 | `lastmod`, `changefreq`, `priority` are optional | verified |
| S5 | URLs normally belong to one host and the sitemap's directory scope | verified |
| S6 | Cross-host submission requires proving control, e.g. via each origin's robots.txt | verified |
| S7 | Google **ignores** `changefreq` and `priority` | verified |
| S8 | Google uses `lastmod` only where consistently accurate and representing a significant change; bulk-updating it causes Google to stop trusting it | verified |

## Verified facts — limits

| # | Fact | Status |
|---|---|---|
| S9 | Maximum 50,000 URLs per sitemap | verified |
| S10 | Maximum 50 MB uncompressed per sitemap | verified |
| S11 | Gzip supported; the **decompressed** file must stay within 50 MB | verified |
| S12 | A sitemap index may list up to 50,000 sitemap files, also capped at 50 MB uncompressed | verified |
| S13 | Google permits up to 500 sitemap index files per Search Console property | verified |

## Verified facts — contents

| # | Fact | Status |
|---|---|---|
| S14 | Include the URLs you want to see in Google's search results | verified |
| S15 | Where several URLs lead to the same content, include only the preferred one | verified |
| S16 | Sitemap inclusion is a **weak** canonicalization hint | verified |
| S17 | Invalid entries do not invalidate the XML; they create conflicting or ineffective signals | verified |

## Verified facts — `Sitemap:` in robots.txt

| # | Fact | Status |
|---|---|---|
| S18 | Requires a complete absolute URL; relative paths are invalid | verified |
| S19 | May appear anywhere in the file, independent of `User-agent` groups | verified |
| S20 | Multiple directives allowed; Google states no limit | verified |
| S21 | Listing only the sitemap index is sufficient | verified |
| S22 | May point to another origin where cross-submission ownership is established | verified |
| S23 | **Not** a core RFC 9309 `Allow`/`Disallow` rule. RFC 9309 permits crawlers to interpret such "other records" and requires they not interfere with robots rule parsing | verified |

## Not adopted

- **"Sitemap quality score."** No such published metric.
- **`Sitemap:` being standardized under RFC 9309.** S23 corrects this.
- **Any claim that invalid entries reduce crawl frequency.** Not documented;
  S17 describes signal conflict, not crawl penalty.
