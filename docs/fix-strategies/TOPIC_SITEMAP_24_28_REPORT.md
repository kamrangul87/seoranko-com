# Topics 24, 25, 27, 28 — sitemap block

Branch: `cursor/sitemap-24-28-922c`
Date: 2026-09-17

## Built

**ONE sitemap inspection** — `inspectSiteSitemaps` / `buildSitemapInspection`
→ `SitemapInspection`. Topics 24, 25, 27, and 28 all classify from that
object (including index following). The sitemap is never parsed four times.

Shared:

| Helper | Role |
|---|---|
| `sitemap-xml` | Protocol parse (urlset + index), limits, namespace, loc edits — topic 26 re-exports |
| `sitemap-inspect` | Fetch declared sitemaps, decompress gzip, follow indexes, collect locs |
| `robots-txt-inspect.sitemapRecords` | `Sitemap:` anywhere in file (S19) |

| Topic | Key behaviour |
|---|---|
| 24 | Declared-but-broken only. Absent sitemap ≠ defect. Never generate one. |
| 25 | Structural validity. changefreq/priority informational (S7). 50 MB = **decompressed**. Never rewrite lastmod. |
| 27 | Six conditions; follow indexes; slash/case → topic 8. Auto only for generator bugs. |
| 28 | Informational only. Never create robots.txt to add `Sitemap:`. |

## Tests assert

- 24: relative→auto-absolutize; 404→human-review; 200 XML / no declaration / index → nothing; transient 5xx→topic 3; generate rejected
- 25: wrong ns + relative loc auto; long loc / 50k+ / gzip-decompressed-oversize raised; changefreq informational; bulk lastmod moderate + rewrite rejected; valid index suppressed
- 27: low omission; noindex/Disallow/child-listed/canonical-elsewhere suppressed; `/page/` vs `/page` → topic 8; orphan elevated + topic 43
- 28: unreferenced informational; UA-group record / index-only / none / multi OK suppressed; robots 404 + sitemap informational with create rejected

## Constraints checked

1. Absent sitemap ≠ defect (24)
2. Missing `Sitemap:` ≠ defect; never create robots.txt (28)
3. changefreq/priority not errors; never rewrite lastmod (25)
4. 50 MB on decompressed; loc &lt; 2048 (25)
5. Six conditions + follow indexes; generator-bug auto only (27)
6. Normalise without collapsing slash/case (27)
