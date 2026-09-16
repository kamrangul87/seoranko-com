# gsc__indexed_vs_crawl_mismatch

Status: READY
Topic: 58 of the issue register
Tier: B — connection-required
Shared facts: `_gsc_shared_facts.md`
Research title: gsc__index_and_crawl_set_divergence (topic 58).
Research date: 2026-09-15

---

## what's actually wrong

Google knows URLs the product's crawl did not find, or the crawl found
indexable URLs Google does not appear to know.

## threshold

A set difference between two URL sets, computed **after canonical
normalisation** (B23).

| Direction | Meaning | Severity |
|---|---|---|
| in GSC, not in our crawl | the URL is not reachable by crawling from the site's own links — an orphan by a different route, or a URL we failed to fetch | moderate |
| in our crawl and indexable, not in GSC | Google may not know it, **or** the data simply was not returned | **low** — see B22 |

The second direction is weak and must be labelled so. B22 says Search
Analytics returns top rows, generally sorted by clicks, and does not guarantee
every underlying row. **Absence from a response is not absence of data.** A
page with no clicks may simply not appear.

## detect

1. Build our crawled URL set.
2. Build the GSC-known set from Search Analytics page rows and, where quota
   allows, URL Inspection (B18).
3. **Normalise both sets canonically** (B23) before differencing — GSC page
   rows are canonical URLs, so raw string comparison produces false
   differences wherever duplicate URL forms exist (topics 8–12).
4. Compute both directions; classify each member.
5. Record quota coverage and date range (B21, B25, B26).

For the GSC-not-in-crawl direction, classify **why** we missed it:

| Reason | Route |
|---|---|
| zero inbound crawlable internal links | topic 43 |
| reachable only via `onclick` or `javascript:` | topic 43 guard C — a real fix |
| blocked by our own crawler config | our defect, not the site's |
| fetch failed during the crawl | re-crawl before reporting |
| URL is a canonical form we normalised away | our normalisation error |

The last two rows are the product's own failures and must be excluded before
anything is reported to the user.

## fix

None for the divergence itself. The actionable cases route elsewhere —
topic 43 for orphans, topic 27 for sitemap omissions.

The genuinely valuable one: a URL Google knows, reachable only via a
non-crawlable link. Converting that to a real `<a href>` is deterministic,
sourced (N1), and has a clean postcondition.

## postcondition

Where a remedy is applied: the URL appears in a subsequent crawl of the site's
link graph. Asserted by re-crawling, not by GSC.

## verdict

`connection-required`. `auto-detectable` for the divergence; fixes belong to
topics 27 and 43.

No GSC connection → silent.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Sets compared without canonical normalisation | false differences (B23). Normalise first |
| 2 | Absence from Search Analytics treated as Google not knowing the URL | **B22** — only top rows are returned. Low severity, state the limitation |
| 3 | Our crawl failed to fetch the URL | our defect. Re-crawl before reporting |
| 4 | URL excluded by our own crawler configuration | our defect, not a finding |
| 5 | Date range or quota truncated the GSC set | state coverage (B21, B25) |
| 6 | Fresh-data request used | may be incomplete (B26). Prefer finalized |
| 7 | URL is `noindex` or non-200 | expected to be absent from the index |
| 8 | No GSC connection | silent |

### Explicitly rejected

- **Raw URL string comparison.** B23.
- **Treating absence from Search Analytics as zero impressions or as Google
  not knowing the URL.** B22.
- **Reporting our own crawl failures as site defects.**
- **Any crawl-budget framing.**

## fixture

A URL in GSC with zero inbound internal links; a URL in GSC reachable only via
`onclick`; `/page/` in GSC and `/page` in our crawl; an indexable crawled URL
absent from GSC; a URL our crawl failed to fetch; no GSC connection.

CI asserts: topic 43 for the first; topic 43 guard C fix for the second;
**suppressed** after normalisation for the third; low severity with the B22
limitation stated for the fourth; re-crawl and no finding for the fifth;
silent for the sixth.

## Cross-references

- topics 8–12 normalisation, 27, 43; topic 59
