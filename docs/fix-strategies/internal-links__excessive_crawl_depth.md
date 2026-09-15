# internal-links__excessive_crawl_depth

Status: READY — metric, not a defect
Topic: 45 of the issue register
Tier: A (measurement) / C (threshold)
Shared facts: `_internal_links_shared_facts.md`
Research title: links__crawl_depth_excessive (topic 45).
Research date: 2026-09-15

---

## what's actually wrong

Possibly nothing. A page is many clicks from the homepage.

## threshold

**Google publishes no numeric click-depth threshold for indexing** (N10). The
only official guidance is qualitative: important pages should be reachable
through navigation from the homepage (N12), and an older article says "within
several clicks" without giving a number (N11).

So there is no sourced threshold, and under the hard filter this cannot be a
defect finding.

What the product can do:

- **measure** click depth deterministically — shortest path in the crawlable
  internal link graph from the homepage, following only `<a href>` links (N1)
- **report** it as an architecture metric with the distribution across the site
- **flag** a depth threshold **only as an explicitly labelled product
  decision**, never attributed to Google

The wording matters. "This page is 7 clicks from your homepage" is a fact.
"This page is too deep and may not be indexed" is an unsupported claim.

## detect

1. Build the internal link graph from crawlable links only — `<a href>` with a
   resolvable URI (N1, N5). Exclude `onclick`-only and `javascript:` links
   (N3), since they are not crawlable and so not depth-reducing.
2. Include links present in the **rendered** result where JavaScript produces a
   real `<a href>` (N4) — but assess the served HTML first (topic 67), and
   record which links required rendering.
3. Shortest path from the homepage per URL.
4. Report the distribution. Depth is undefined, not infinite, for pages with
   no inbound crawlable link — those are topic 43.

## fix

**None.** Reducing click depth means changing site navigation or information
architecture. There is no deterministic transform, no postcondition that
proves improvement, and the change is an editorial decision about what belongs
in navigation.

The agent reports depth and, usefully, the **shortest path** to each deep
page — that tells a human exactly which link would shorten it most.

## postcondition

n/a — no transform.

## verdict

`not_mechanically_fixable`. Measurement and reporting only.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | A numeric depth threshold is attributed to Google | **unsupported** (N10). Reword or remove |
| 2 | Any claim that depth beyond N clicks prevents or risks de-indexing | fabricated. Never state |
| 3 | Page has no inbound crawlable link | depth undefined. Topic 43, not this |
| 4 | Depth computed including non-crawlable links | invalid — `onclick` and `javascript:` links do not reduce depth (N1, N3) |
| 5 | Depth computed from the hydrated DOM only | record which links needed rendering; assess served HTML first (topic 67) |
| 6 | Homepage not identified, or multiple entry points | state the assumed root; depth is relative to it |
| 7 | Paginated archives inflating depth | depth via pagination is a known pattern; report it as such rather than as a finding |
| 8 | Site is small enough that depth is trivially low | no finding. Do not report noise |

### Explicitly rejected

- **Any click-depth table mapping clicks to crawl frequency or indexing
  outcome.** Fabricated; N10.
- **"Google measures page importance using click depth."** Not documented.
- **PageRank distribution claims.**
- **Treating depth as a defect.** It is an architecture metric.
- **Auto-modifying navigation to reduce depth.** Editorial.

## fixture

A page 2 clicks deep; 7 clicks deep; reachable only via an `onclick` handler;
reachable only via a JavaScript-rendered `<a href>`; with no inbound link at
all; reachable only through 12 pages of pagination.

CI asserts: no finding for the first; metric reported for the second; the
third treated as **not** reducing depth; the fourth counted with a
render-required flag; routed to topic 43 for the fifth; pagination pattern
labelled for the sixth. **No severity attributed to any depth value.**

## Cross-references

- topic 43 orphan pages (depth undefined); topics 1, 42; topic 67
