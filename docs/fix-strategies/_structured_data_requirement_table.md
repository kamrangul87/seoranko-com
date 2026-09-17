# Structured-data requirement table (topic 35)

Maintained artefact referenced by `structured-data__required_properties_absent.md`.
A type with no entry here produces **no finding**.

Every entry must carry: Google feature-page URL, required properties, recommended
properties, and **verified-on** date. Re-verify before raising when the Google
page's last-updated date is later than verified-on.

| Type(s) | Feature page | Required | Recommended | Verified-on | Notes |
|---|---|---|---|---|---|
| `Article`, `NewsArticle`, `BlogPosting` | https://developers.google.com/search/docs/appearance/structured-data/article | *(none — Google: "There are no required properties")* | `author`, `author.name`, `author.url`, `dateModified`, `datePublished`, `headline`, `image` | 2026-09-15 | Feature page last updated 2026-09-08. `image`: crawlable/indexable; for best results multiple high-resolution images, **minimum 50K pixels (width × height)**, aspects 16x9 / 4x3 / 1x1. Stale thresholds **not adopted**: 1200px wide, 800,000 total pixels. Image is recommended, not required. |
| `BreadcrumbList` | https://developers.google.com/search/docs/appearance/structured-data/breadcrumb | `itemListElement` | *(none listed for this pass)* | 2026-09-15 | Required for Breadcrumb rich results. |

Types intentionally absent from this table are unknown to the product — do not
infer requirements from schema.org.
