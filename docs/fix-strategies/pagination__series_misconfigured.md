# pagination__series_misconfigured

Status: READY — report-only (no safe mechanical rewrite of series architecture)
Topic: 71 of the issue register
Tier: A
Research title: pagination__series_misconfigured (topic 71).
Research date: 2026-10-01

---

## what's actually wrong

A paginated collection is misconfigured for Google’s crawl model: later pages
canonicalise to page 1, page numbers exist only as URL fragments, or “next”
exists only as a non-crawlable control. Missing `rel=next` / `rel=prev` is
**not** wrong — Google no longer uses those tags.

## primary source

- Google, Pagination, incremental page loading —
  https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading
  (`_sources.md` #116, verified 2026-10-01)
- Google, Fix lazy-loaded content —
  https://developers.google.com/search/docs/crawling-indexing/javascript/lazy-loading
  (`_sources.md` #117)
- Google, 5 common mistakes with rel=canonical (2013) —
  https://developers.google.com/search/blog/2013/04/5-common-mistakes-with-relcanonical
  (`_sources.md` #118) — confirms page-2→page-1 canonical is incorrect
- Google, Crawling December: Faceted navigation (2024-12-17) —
  https://developers.google.com/search/blog/2024/12/crawling-december-faceted-nav
  (`_sources.md` #119) — boundary vs filter/sort URL explosion

Historical (context only, not thresholds): view-all preference blog (2011);
rel=next/prev introduction (2011) — superseded by #116 (“Google no longer
uses these tags”).

## threshold

| Signal | Sourced rule |
|---|---|
| Canonical | Each page in a sequence has its **own** canonical. Do **not** use the first page as the canonical for page 2+ (#116, #118). Canonical to a true **view-all** superset remains a documented pattern in older guidance; choosing self vs view-all is site-specific → not auto-fixable |
| URL shape | Unique URL per page (e.g. `?page=n`). Fragment identifiers (`#…`) are ignored for distinct pages (#116) |
| Discovery | Sequential crawlable `<a href>` links. Googlebot does not click buttons or user-action JS (#116, #117) |
| rel=next/prev | **Not used by Google** (#116). Absence → never a finding. Presence → informational only |
| Titles | Same title/description across a sequence is OK (#116) — topic 33 must suppress |
| Sitemap | No mandate to list every page-N URL; topic 27 already allows deliberate omission of parameterised/paginated locs |
| Facets | Filter/sort variants are **not** pagination (#116, #119). Facets may use noindex/robots; page-N sequences should remain crawlable when indexable |

**No sourced numeric threshold** (max pages, “must view-all after N”). Unset
product decisions — do not invent.

## detect

1. Classify URLs with structural page tokens: `page` / `paged` / `pagenum` /
   `pg` query params, or `/page/N/` path (not bare `?p=` — often a CMS id).
2. For page ≥2: if declared HTML canonical resolves to series page 1 →
   `page-canonical-to-series-first`.
3. If `<a href="#…page…">` fragment pagination → `fragment-only-pagination`.
4. If `link[rel=next]` or data-*/onclick attributes carry a page-N URL but no
   crawlable `<a href>` to page ≥2 → `noncrawlable-next-without-href`.
5. If `rel=next`/`rel=prev` present → informational only (Google unused).
6. Never raise for missing `rel=next`/`rel=prev`.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Canonical points at a true view-all URL that is not series page 1 | not this finding (view-all pattern) |
| 2 | Page 1 self-canonical / page 2 self-canonical | ok |
| 3 | Faceted `?color=` / `?order=` URLs | not pagination; topic 12 12b / robots |
| 4 | Bare `?p=` CMS post id | not treated as pagination |
| 5 | Missing rel=next/prev | **never a finding** |
| 6 | Paginated URLs absent from sitemap | topic 27 suppress — may be deliberate |
| 7 | Shared titles across page-N | topic 33 `suppress-paginated` |
| 8 | High click depth via `/page/N/` | topic 45 `metric-pagination-pattern` |
| 9 | Topic 12 duplicate collapse of `?page=` | `suppress-paginated` |

### Explicitly rejected

- **Requiring or proposing rel=next/prev for Google.** Superseded (#116).
- **Auto-rewriting every page-2+ canonical to self** without confirming no
  view-all strategy — not mechanically safe.
- **Inventing a page-count or view-all threshold.**
- **Treating filter/sort faceted URLs as pagination.**
- **Body-copy / button-label matching** (“Load more” text) — structural
  attributes only.

## fix

**Report-only** for all current verdicts:

- Self-canonical (or correct view-all) on page 2+ — human chooses.
- Replace fragment pagination with crawlable `?page=n` / `/page/n/` URLs.
- Add crawlable `<a href>` sequential links (architecture / template change).

No WordPress/theme auto-fix in this product.

## postcondition

Live: page ≥2 either self-canonicalises or canonicalises to a verified
view-all URL that is not series page 1; pagination uses crawlable distinct
URLs with `<a href>` discovery. Asserted by re-crawl, not by GSC.

## idempotent?

Yes (detect-only).

## risk / blast radius

Changing canonicals across an archive can drop page-2+ from the index if
done wrong (exactly the failure #118 describes). Prefer human-review.

## rollback

Revert template / canonical changes.

## verdict

`not_mechanically_fixable` / report-only for actionable findings.
Informational for residual rel=next/prev markup.
Cross-topic: strengthens suppress/metric paths in 12, 27, 33, 45.

## fixture

- `/shop?page=2` canonical → `/shop` → finding
- `/shop?page=2` self-canonical + `<a href=?page=3>` → ok
- `#page-2` only → fragment finding
- `rel=next` without crawlable page-2 `<a href>` → noncrawlable-next
- no `rel=next` → no finding for that reason
- `?page=2` vs clean URL in topic 12 → suppress-paginated (not 12b)
