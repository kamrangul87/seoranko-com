# seoranko-fixture-site

Minimal **static** site used to exercise Fix Agent deterministic transforms
end-to-end (detect → apply → verify). Host name in loc/canonical strings is
`https://fixture.example` — rewrite to the deployed origin when hosting.

## Seeded defects (one per wired topic)

| Topic | Seeded defect | Expected finding (verdict) | File |
|------:|---------------|----------------------------|------|
| 1 | `<a href="/gone.html">` on home — target 404 | `auto-fixable` (remove-anchor) | `index.html` |
| 13 | (optional) about page without preferred canonical when duplicates proven | `auto-add-self-canonical` | `about.html` |
| 14 | About page canonical points at `/dead-canonical.html` (404) | `auto-self-canonical` | `about.html` |
| 17 | Home has two identical `<link rel="canonical">` tags | `auto-collapse-redundant` | `index.html` |
| 22 | `Crawl-delay: 10` in robots.txt | `auto-remove-crawl-delay` | `robots.txt` |
| 26 | Sitemap lists `/gone.html` (4xx) | `auto-remove-confirmed-4xx` | `sitemap.xml` |
| 26 | Sitemap lists `/old-blog` (301 → `/blog/`) | `auto-replace-single-hop-redirect` | `sitemap.xml` |
| 42 | Home links to `/old-blog` which 301s to `/blog/` | `auto-rewrite` | `index.html` |
| 49 | Blog img `/images/hero.jpg` has no width/height | `auto-set-dimensions` | `blog/index.html` |

## Deliberately not seeded

- **Topic 28** (`informational-unreferenced`) — informational by design; not Fix Agent auto-fixable.
- **Topic 22 `auto-set-text-plain`** — config/header edit; not registered in this wire-up.
- **Topic 17 `human-review-conflicting`**, **topic 42 `human-review-shared-nav`**, and other human-review verdicts.

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

## Expected Fix Agent path

Static HTML + `public/`-style paths when imported into a customer repo
(`public/index.html`, `public/sitemap.xml`, `public/robots.txt`, …).
JSX/TSX and generated `app/sitemap.ts` are out of scope for these transforms.
