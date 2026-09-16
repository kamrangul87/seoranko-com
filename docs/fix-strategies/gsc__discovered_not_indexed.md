# gsc__discovered_not_indexed

Status: READY — report-only
Topic: 56 of the issue register
Tier: B — connection-required
Shared facts: `_gsc_shared_facts.md`
Research title: gsc__discovered_not_indexed (topic 56).
Research date: 2026-09-15

---

## what's actually wrong

Google knows the URL exists but has not crawled it yet.

## threshold

GSC reports the state "Discovered — currently not indexed" for a URL, and the
last crawl date is empty (B8).

**This is not necessarily an error** (B4). Google's stated reason is that the
crawl was typically postponed because crawling was expected to overload the
site (B7) — but B9 is explicit that this is typical context, **not proof** the
server is overloaded.

What the agent can add, all mechanical:

| Corroborating check | Source | Meaning |
|---|---|---|
| the URL returns persistent 5xx on our own crawl | topic 3 | server availability is a real, independent problem |
| the URL is slow to respond across repeated fetches | own crawl | supports the overload context, without asserting it |
| the URL has zero inbound crawlable internal links | topic 43 | discovery came from elsewhere; internal linking is a mechanical remedy |
| the URL is absent from the sitemap | topic 27 | another mechanical remedy, noting B10 |
| the URL is `Disallow`ed for Googlebot | topic 21 | a different state should apply; investigate the conflict |

Where none of these hold, the honest finding is: Google knows about this URL
and has not crawled it yet, with the state's own definition quoted and nothing
inferred.

## detect

1. Query the Page Indexing state per URL (B14–B18). Respect the 2,000/day cap.
2. Confirm the last crawl date is empty (B8).
3. Run the corroborating checks above using the product's own crawl data.
4. Record the GSC crawl date (B5).

## fix

**None for the state itself.** Nothing the agent can change makes Google
crawl a URL, and B10 says a sitemap or repeated submission does not guarantee
it. B19 confirms the Inspection API is not a submission mechanism.

Two mechanical remedies are genuinely available and each belongs to its own
topic:

- add an inbound internal link (topic 43)
- add the URL to the sitemap (topic 27), while stating B10 — this aids
  discovery but guarantees nothing

Both are proposed with honest framing about what they do and do not do.

## postcondition

Deferred and probabilistic, so not a postcondition in the usual sense:
re-query the state after a remedy has been verified live and record whether it
changed. Never asserted as an outcome of the fix.

## verdict

`connection-required`, report-only. `not_mechanically_fixable` for the state.

No GSC connection → silent.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Server slowness asserted from the state alone | B9 — context, not proof. Corroborate or say nothing |
| 2 | Reported as a current condition | historical (B5) |
| 3 | Last crawl date is populated | not this state. Check the classification |
| 4 | URL is intentionally unlinked and unlisted | may be deliberate. Low severity |
| 5 | URL is `noindex` or `Disallow`ed | a different state applies; investigate rather than raising this |
| 6 | Sitemap addition framed as a guaranteed remedy | B10. Reword |
| 7 | No GSC connection | silent |
| 8 | Coverage partial under the 2,000/day cap | state it (B18) |

### Explicitly rejected

- **Asserting the server is overloaded.** B9.
- **Crawl-budget remedies.** Unsourced.
- **Claiming a sitemap addition will get the URL crawled.** B10.
- **Using the Inspection API as a submission mechanism.** B19.

## fixture

A URL in this state with zero inbound internal links; in this state with a
persistent 5xx on our crawl; in this state with no corroborating signal; in
this state but `Disallow`ed; no GSC connection.

CI asserts: topic 43 remedy proposed for the first; topic 3 finding raised
alongside for the second; state reported with **nothing inferred** for the
third; conflict flagged for the fourth; silent for the fifth.

## Cross-references

- topics 3, 21, 27, 43, 57
