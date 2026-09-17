# internal-links__orphan_pages

Status: READY
Topic: 43 of the issue register
Tier: A
Shared facts: `_internal_links_shared_facts.md`
Research title: links__orphan_pages (topic 43).
Research date: 2026-09-15

---

## what's actually wrong

A page that should be part of the site has **zero inbound crawlable internal
links** — it is orphaned in the site's link graph.

## threshold

Google recommends that every page you care about should have a link from at
least one other page on your site (N7).

**Claim boundary (N8):**

| Provable | Not provable |
|---|---|
| the page has zero inbound crawlable internal links, so it is orphaned in the site's link graph | Google cannot discover or index this page |

Discovery may also come from XML sitemaps, external links, previously crawled
URLs, and redirects (N8). A sitemap aids discovery but does not replace
internal architecture and does not guarantee crawling or indexing (N9).

Only crawlable links count toward "inbound" (N1, N3, N5): an `<a>` with a
resolvable `href`. A page reachable only via `onclick` or `javascript:` **is**
orphaned in the crawlable graph. A page linked only by a JavaScript-rendered
real `<a href>` is **not** orphaned, but record that rendering was required
(N4).

## detect

1. Build the crawlable internal link graph from served HTML (topic 67), then
   note any additional edges that appear only after render (N4).
2. For each indexable 200 page that is not the site root: count inbound
   crawlable internal links.
3. Zero → finding. Depth is undefined for these pages (topic 45).

## fix

Add at least one contextual internal link from a related indexable page.

- **`onclick` / `javascript:` only inbound** → converting to a real `<a href>`
  is deterministic and sourced (N1, N3). Prefer that when it is the only
  inbound path.
- **No related page to link from** → `human-review` (architecture / editorial).
- **Do not** treat "add to sitemap" as the fix (N9). Sitemap listing may lower
  severity (discovery not blocked) but does not close the graph orphan.

## postcondition

Live: at least one other internal page's served HTML contains a crawlable
`<a href>` to the URL. Asserted via a code path separate from the executor.

## idempotent?

Yes for adding a link that is already present.

## risk / blast radius

A single source page for a body link; shared nav/header/footer if that is
where the link is added — resolve declaration site via topic 70.

## rollback

Revert.

## verdict

`detect-and-report` for link-graph orphans. The only mechanical remediation
that is even theoretically deterministic is converting a non-crawlable inbound
control (`onclick` / `javascript:`) to a real `<a href>` when the target URL
is already known — and that rewriter is **not shipped**. Code flags
`finding-orphan-onclick-only` with a `convertNonCrawlableToAnchor` remediation
hint (`autoFixable: false` until a fixer lands).

`human-review` for campaign/landing pages that may be intentionally unlinked,
and for any case requiring editorial choice of source page or anchor text.

`not_mechanically_fixable` for inventing relatedness, navigation IA, or
filling a related-link slot (editorial). Sitemap inclusion lowers severity; it
does not close the finding (N9).

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Page is the site root | excluded |
| 2 | Page is `noindex` or non-200 | not a finding |
| 3 | Page is listed in the XML sitemap | still orphaned in the link graph, but discovery is not blocked (N8, N9). Lower severity, and say so |
| 4 | Page has external inbound links | not detectable without a backlink API — unavailable. State the limitation rather than assuming none |
| 5 | Page reachable only via `onclick` or `javascript:` | **is** orphaned (N1, N3) — most actionable variant |
| 6 | Page reachable only via JS-rendered `<a href>` | **not** orphaned (N4). Flag that rendering was required |
| 7 | Deliberate landing or campaign page | often intentionally unlinked. `human-review` |
| 8 | Wording claims Google cannot discover/index the page | unsupported (N8). Reword to link-graph orphan only |

### Explicitly rejected

- **"Orphan pages lack internal PageRank signals" / "rarely rank for
  competitive queries."** Unsourced.
- **The Indexing API as a general orphan remedy.** Limited to specific content
  types; not a general fix.
- **Treating sitemap inclusion as closing the finding.** N9.
- **Asserting undiscoverability from zero internal links.** N8.

## fixture

An indexable page with zero inbound crawlable links; the same page listed in
the sitemap; a page reachable only via `onclick`; a page reachable only via a
JS-rendered `<a href>`; the homepage; a `noindex` orphan; a campaign landing
page flagged for human review.

CI asserts: finding for the first; lower-severity finding naming sitemap for
the second; finding for the third (orphaned); **no** orphan finding for the
fourth (render-required flag); nothing for homepage / noindex; human-review
for the campaign case. Wording never claims undiscoverability.

## Cross-references

- topic 27 (sitemap omission — absent from both sitemap and link graph is the
  elevated case); topic 45 (depth undefined for orphans); topic 1; topics 67,
  70

## Sources for this merge

Facts N1, N3–N5, N7–N9 landed from the 2026-09-15 internal-links research
pass (`SUPPLEMENT-topic-43-orphan-pages.md`). Prior "dossier written elsewhere"
stub content was not in this repo; this file is the in-repo READY dossier.
