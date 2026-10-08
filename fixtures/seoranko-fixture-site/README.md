# seoranko-fixture-site

Minimal **static** site for Fix Agent one-run exercises. Defects that can use
root-relative URLs do so (anchors, img src, canonicals) so the HTML works on
any host. Sitemap `<loc>` values are absolute and point at the live fixture
host `https://seoranko-fixture.vercel.app`.

## Seeded defects (wired topics)

| Topic | Seeded defect | Expected finding (verdict) | File |
|------:|---------------|----------------------------|------|
| **49** | `<img src="/images/hero.jpg">` missing width/height + CSS `height: auto` | `auto-set-dimensions` | `blog/index.html` |
| **1** | `<a href="/gone.html">` — target 404 | `human-review` / `no-action` (dossier: auto-remove only with git deletion or 410) | `index.html` |
| **14** | `<link rel="canonical" href="/dead-canonical.html">` — target not 200 | `auto-self-canonical` | `about.html` |
| **17** | Two identical `<link rel="canonical" href="/">` in head | `auto-collapse-redundant` | `index.html` |
| **22** | `Crawl-delay: 10` in robots.txt | `auto-remove-crawl-delay` | `robots.txt` |
| **26** | Sitemap lists `/gone.html` (4xx) and `/old-blog` (301→`/blog/`) | `auto-remove-confirmed-4xx` / `auto-replace-single-hop-redirect` | `sitemap.xml` |
| **42** | `<a href="/old-blog">` (redirect hop to `/blog/`) | `auto-rewrite` | `index.html` |

## Layout

```
index.html
about.html
blog/index.html
images/hero.jpg
sitemap.xml
robots.txt
vercel.json   # permanent redirect /old-blog → /blog/
```

## Notes

- No `gone.html` or `dead-canonical.html` files — those URLs must 404.
- `/old-blog` is redirected by `vercel.json` (or equivalent host config).
- Topic 13 is **not** seeded here (excluded from Fix Agent registry).
