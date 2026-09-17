# sitemap__not_referenced_in_robots

Status: READY — informational
Topic: 28 of the issue register
Tier: A
Shared facts: `_sitemap_shared_facts.md`
Research date: 2026-09-15

---

## what's actually wrong

Very little. A sitemap exists but is not declared in `robots.txt`.

## threshold

**Not a defect.** Nothing requires the `Sitemap:` record, and it is not even a
core RFC 9309 rule — it is an "other record" that crawlers may interpret
(S23). A sitemap submitted through Search Console works without it.

The honest finding is a **discoverability gap**, and only where both hold:

- a sitemap exists and is reachable
- no `Sitemap:` record in robots.txt points at it or at an index containing it

Severity: informational. It rises to low only where there is no evidence of
any other submission route, which the agent usually cannot determine — Search
Console submission is not visible from a crawl.

Separate, genuine findings in the same area:

| Condition | Source | Severity |
|---|---|---|
| `Sitemap:` record uses a relative URL | S18 | high — invalid, never fetched. Belongs to topic 24 |
| `Sitemap:` record points at a 404 | — | high. Topic 24 |
| `Sitemap:` record placed inside a `User-agent` group and assumed scoped | S19 | none. It is group-independent |
| multiple `Sitemap:` records | S20 | none. Permitted, no limit |
| only the index declared, not its children | S21 | none. Sufficient |

## detect

1. Parse robots.txt for `Sitemap:` records (S19 — anywhere in the file).
2. Resolve each; follow any sitemap index to collect child sitemaps.
3. Compare against sitemaps discovered by other means (conventional paths, a
   `sitemap.ts` route in the repo, links in the HTML).
4. A reachable sitemap covered by no record → informational finding.

## fix

Add a `Sitemap:` record with the absolute URL. Where a sitemap index exists,
declare the index only (S21).

Shipped as `topic-28/fix-add-sitemap-record.ts` (`proposeAddSitemapRecord` /
`applyAddSitemapRecord`). Never creates `robots.txt` from scratch.

Deterministic and low risk — it adds a discoverability hint and changes no
crawl permissions.

## postcondition

Live `robots.txt` contains a `Sitemap:` record with an absolute URL that
returns 200 XML, and the record does not interfere with `Allow`/`Disallow`
parsing (S23).

## idempotent?

Yes.

## risk / blast radius

`robots.txt`, or the `robots.ts` route. The record itself is inert with
respect to crawl permissions — but the file governs the whole origin, so the
edit must not disturb existing rules. That is the one real risk here, and it
is why the postcondition checks rule parsing as well as the record.

## rollback

Revert.

## verdict

`auto-fixable`, but low value. Adding the record is deterministic, reversible
and changes no permissions. Worth doing when the file is already being
modified for another finding; not worth raising on its own beyond
informational.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | No sitemap exists | nothing to declare. Never raise |
| 2 | Sitemap index declared, children not | sufficient (S21). Never raise |
| 3 | Record present but placed inside a `User-agent` group | valid and group-independent (S19). Never raise |
| 4 | Sitemap declared on another origin with cross-submission established | valid (S22). Never raise |
| 5 | robots.txt unreachable or 5xx | topic 22 first |
| 6 | robots.txt returns 404 | normal (topic 22). Adding a file solely to declare a sitemap is a bigger change than the finding warrants — do not propose it |
| 7 | Sitemap may be submitted via Search Console | not visible from a crawl. State the uncertainty rather than asserting a gap |

### Explicitly rejected

- **Treating a missing `Sitemap:` record as a defect.** Not required, and not
  a core RFC 9309 rule.
- **Creating a `robots.txt` just to add the record.** A 404 robots.txt is
  normal; the fix would be larger than the finding.
- **Asserting no sitemap was submitted.** Search Console submission is
  invisible to a crawler.
- **Claiming a crawl or ranking effect.** Undocumented.

## fixture

Reachable sitemap with no `Sitemap:` record; record present inside a
`User-agent` group; index declared without children; no sitemap at all;
robots.txt returning 404 with a sitemap present; multiple records.

CI asserts: informational for the first and fifth (with the uncertainty
stated, and no file creation proposed for the fifth); nothing for the second,
third, fourth and sixth.

## Cross-references

- topic 22 robots.txt validity; topic 24 declared-but-broken sitemaps;
  topics 25, 26, 27
