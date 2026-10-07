# seoranko-fixture-site

Minimal **static** site for Fix Agent exercises. Host name in loc/canonical
strings is `https://fixture.example` — rewrite to the deployed origin when hosting.

## Wired today (passes Phase 2 pre-checks)

| Topic | Seeded defect | Expected finding (verdict) | File |
|------:|---------------|----------------------------|------|
| 49 | Blog img `/images/hero.jpg` has no width/height | `auto-set-dimensions` | `blog/index.html` |

## Seeded but NOT wired (failed Phase 2 pre-check — exact repo file target not on emit)

These defects remain in the tree for a future wire-up once detectors persist
an exact editable path (no guessing). They must **not** surface as Fix Agent
auto-fixable until registered.

| Topic | Seeded defect | Would-be verdict | File | Pre-check failure |
|------:|---------------|------------------|------|-------------------|
| 1 | `<a href="/gone.html">` on home | `auto-fixable` | `index.html` | No exact file target on emit |
| 13/14 | About canonical → dead URL / absent preferred | `auto-self-canonical` / `auto-add-self-canonical` | `about.html` | No exact file; crawl hardcodes `duplicatesProven: false` for 13 |
| 17 | Duplicate identical canonicals on home | `auto-collapse-redundant` | `index.html` | No exact file target on emit |
| 22 | `Crawl-delay: 10` | `auto-remove-crawl-delay` | `robots.txt` | No exact file target on emit |
| 26 | Sitemap lists `/gone.html` and `/old-blog` | remove / replace | `sitemap.xml` | Live crawl forces generated+unknown generator; no repo path |
| 28 | (informational) | `informational-unreferenced` | — | Informational by design; no verifier |
| 42 | Link to `/old-blog` (301 → `/blog/`) | `auto-rewrite` | `index.html` | Crawl omits `repoRoot`; declaration file null |

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
