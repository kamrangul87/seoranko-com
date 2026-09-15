# robots__syntax_invalid_or_unreachable

Status: READY
Topic: 22 of the issue register
Tier: A
Shared facts: `_robots_shared_facts.md`
Research title: invalid_or_unreachable (topic 22).
Research date: 2026-09-15

---

## what's actually wrong

`/robots.txt` is unreachable, served incorrectly, or contains rules that do
not parse.

## threshold

Several distinct conditions, each with a different severity. They are not one
finding.

| Condition | Source | Consequence | Severity |
|---|---|---|---|
| robots.txt returns 5xx or is unreachable | R21 | crawlers must assume **complete disallow** initially | **critical** |
| served with a non-`text/plain` content type | R13 | may not be parsed | high |
| not UTF-8 | R13 | rules may be misread | high |
| exceeds 500 KiB | R24 | rules past the limit are silently ignored | high |
| contains `noindex` directives | R9 | unsupported since 2019; the author believes pages are excluded when they are not | high |
| contains `crawl-delay` | R26 | ignored by Google; harmless but ineffective | informational |
| unparseable or malformed lines | RFC 9309 | those rules do not apply | moderate |
| returns 4xx | R20 | crawling permitted — **this is normal**, not a defect | none |

The critical row is the one that matters most and is the least obvious: a 5xx
on `robots.txt` can halt crawling of the entire site, while a 404 on the same
file is completely fine.

## detect

1. Fetch `/robots.txt` at the origin top level, lowercase path (R12).
2. Record status, content type, encoding, byte size.
3. Parse line by line. Record unparseable lines, `noindex` directives,
   `crawl-delay`, and any content beyond 500 KiB.
4. Re-fetch per topic 68 before raising the 5xx case — a transient 5xx is not
   a site defect (topic 3).

## fix

Per condition:

- **5xx / unreachable** → no repo transform. Server or platform issue.
  Report. Same reasoning as topic 3.
- **wrong content type** → deterministic: serve `text/plain`. On Next.js this
  is the `robots.ts` route or a static file's headers.
- **`noindex` directives present** → deterministic removal, but it **changes
  behaviour**: the author's intent was exclusion, which robots.txt never
  delivered. Removing the line without adding a real `noindex` leaves the
  page still indexable. Propose both changes together, human-review.
- **`crawl-delay`** → removal is safe and changes nothing. Informational.
- **exceeds 500 KiB** → report which rules fall past the limit. Trimming is
  the owner's decision.
- **malformed lines** → report the lines. Correcting them changes crawl
  permissions, so human-review.

## postcondition

Live `/robots.txt` returns 200 with `text/plain`, UTF-8, under 500 KiB, and
every line parses.

## idempotent?

Yes for content-type and directive removals.

## risk / blast radius

Highest in the register. `robots.txt` governs crawl access for the entire
origin. A wrong edit can block the whole site or expose paths the owner
intended to keep out of crawlers.

## rollback

Revert. Note that a crawl halt caused by a 5xx may take time to recover even
after the file is fixed.

## verdict

`auto-fixable` for two cases only: setting `text/plain`, and removing
`crawl-delay`. Both are no-ops to crawl permissions.

`human-review` for everything else. `not_mechanically_fixable` for the
5xx/unreachable case.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | robots.txt returns 404 | permitted and normal (R20). **Never raise** |
| 2 | 5xx observed once | re-fetch first (topic 68); transient is topic 3 |
| 3 | File exists at a non-root path | not the robots.txt of record (R12). Do not evaluate it |
| 4 | Rules beyond 500 KiB | already ignored (R24). Do not report them as active rules |
| 5 | Unrecognised but syntactically valid directive | other crawlers may use it. Do not remove |
| 6 | robots.txt used to protect sensitive paths | it is not access control (R23) — report the misuse, never "fix" it by removing the rule |

### Explicitly rejected

- **Treating a 404 robots.txt as a defect.** Explicitly fine per R20. This is
  the most likely false positive in the topic.
- **Auto-removing `noindex` lines alone.** Leaves the author's intent
  unfulfilled and silently makes pages indexable.
- **Auto-editing any `Disallow` rule.** Blast radius is the whole origin.
- **Adding a robots.txt where none exists.** Absence is not a defect.

## fixture

robots.txt returning 5xx twice; returning 404; served as `text/html`;
containing `noindex: /private`; containing `crawl-delay: 10`; 600 KiB with
rules past the limit; a malformed line; a valid minimal file.

CI asserts: critical for the first; suppressed for the second; auto-fix for
the third and fifth; human-review with paired proposal for the fourth;
limit-boundary reported for the sixth; line reported for the seventh; nothing
for the eighth.

## Cross-references

- topic 21 depends on this parser; topics 3, 68; topic 28 sitemap reference in
  robots.txt
