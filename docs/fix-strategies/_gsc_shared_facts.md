# Shared facts — GSC-dependent block (topics 55–59)

Research date: 2026-09-15

## Tier B: what "connection-required" means in practice

Every topic in this block needs a Google Search Console connection. Each
dossier must define its behaviour when no connection exists — silence, not a
false negative.

Two guards apply to the entire block and are not repeated in full per file:

**Historical, not current.** GSC states reflect the crawl that produced them,
not the URL's condition now. A page fixed today may show last week's error for
days. Every finding must carry the crawl date and must never assert a current
fault. (Established in topic 3.)

**API labels may be coarser than the UI.** An earlier research pass found
`CoverageState` returning "Not Found (404)" for 410 URLs as well, and it did
not reliably indicate whether the URL was still indexed. Treat API state
strings as coarse signals and never as the sole evidence for a finding.
This needs re-verification against current API behaviour — recorded as an
open question below.

## primary source

- Google, Page Indexing report —
  https://support.google.com/webmasters/answer/7440203
- Google, URL Inspection API —
  https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- Google, Search Console API limits —
  https://developers.google.com/webmaster-tools/limits
- Google, Search Analytics query API —
  https://developers.google.com/webmaster-tools/v1/searchanalytics/query

## Verified facts — the report

| # | Fact | Status |
|---|---|---|
| B1 | The former Coverage report is now the **Page Indexing report** | verified |
| B2 | Not-indexed states include: Server error (5xx), Redirect error, Blocked by robots.txt, Marked `noindex`, Soft 404, Unauthorized (401), Not found (404), Forbidden (403), Other 4xx, Crawled — currently not indexed, Discovered — currently not indexed, Alternate page with proper canonical, Duplicate without user-selected canonical, Duplicate Google chose another canonical, Page with redirect | verified |
| B3 | Warning states: Indexed despite robots.txt blocking; Indexed without content | verified |
| B4 | **"Not indexed" is not necessarily an error.** Redirects, canonical alternates and intentionally noindexed pages can be correct | verified |
| B5 | These states represent Google's historical processing, not the current live response | verified |

## Verified facts — the two "not indexed" states

| # | Fact | Status |
|---|---|---|
| B6 | **Discovered — currently not indexed:** "The page was found by Google, but not crawled yet" | verified |
| B7 | Google says the crawl was typically postponed because crawling was expected to overload the site | verified |
| B8 | For this state the last crawl date is **empty**, and no page-content assessment has occurred | verified |
| B9 | "Expected overload" is typical context, **not proof** the server is overloaded | verified |
| B10 | A sitemap or repeated submission does not guarantee immediate crawling | verified |
| B11 | **Crawled — currently not indexed:** "The page was crawled by Google but not indexed. It may or may not be indexed in the future; no need to resubmit this URL for crawling" | verified |
| B12 | **Google does not publish the classifier or threshold for this state** | verified |
| B13 | Both states are indexing-time states that a live URL test cannot reproduce | verified |

**B12 is the governing constraint for topic 57.** The state must not be
translated into "thin content", "duplicate content" or "quality failure"
without separate evidence.

## Verified facts — URL Inspection API

| # | Fact | Status |
|---|---|---|
| B14 | Inspects **one URL per request** | verified |
| B15 | Returns only information about Google's **indexed version** | verified |
| B16 | **Cannot run the live URL test** | verified |
| B17 | The inspected URL must belong to the supplied Search Console property | verified |
| B18 | Quota: **2,000 requests/day and 600/minute per site**; 10,000,000/day and 15,000/minute per project | verified |
| B19 | It is an inspection API, **not** an indexing-submission API | verified |

**B18 is a hard design constraint.** A site with more than 2,000 URLs cannot
be fully inspected in a day. Every topic using this API needs a prioritisation
policy, and that policy is a product decision.

## Verified facts — Search Analytics API

| # | Fact | Status |
|---|---|---|
| B20 | `rowLimit` 1–25,000 per request; default 1,000; paginate with `startRow` | verified |
| B21 | Maximum **50,000 rows per day per search type** | verified |
| B22 | Returns top rows, generally sorted by clicks; does **not** guarantee every underlying row | verified |
| B23 | **Aggregation by page uses canonical URLs** | verified |
| B24 | Query quotas: 1,200/minute per site and per user; 40,000/minute and 30,000,000/day per project | verified |
| B25 | Opaque load quotas apply over 10-minute and 1-day windows. Long date ranges, and grouping or filtering by both page and query, are especially expensive | verified |
| B26 | Fresh-data requests may include incomplete data; finalized data is the default | verified |

**B23 is the other major design fact.** GSC page rows are canonical URLs, so
comparing them to crawled URLs requires canonical normalisation first. Raw
string matching will produce false differences wherever the site has
duplicate URL forms (topics 8–12).

**B22 means absence from a Search Analytics response is not absence of data.**
Only top rows are returned.

## Not adopted across the whole block

- **"Crawled — currently not indexed means thin or duplicate content."** B12 —
  no published classifier. This is the most common unsourced inference in the
  whole register.
- **"Discovered — currently not indexed means your server is slow."** B9 —
  typical context, not proof.
- **Crawl-budget and "internal link equity" remedies.** Unsourced.
- **Treating any GSC state as the current live condition.** B5.
- **Treating absence from a Search Analytics response as zero impressions.**
  B22.

## Open questions

1. Re-verify whether `CoverageState` in the current API still returns
   "Not Found (404)" for 410 URLs, and whether it reliably distinguishes
   indexed from not-indexed. The earlier observation predates this pass.
2. Set the URL Inspection prioritisation policy under B18 as an explicit
   product decision.
