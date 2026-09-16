# sitemap__missing_or_unreachable

Status: READY
Topic: 24 of the issue register
Tier: A
Shared facts: `_sitemap_shared_facts.md`
Research date: 2026-09-15

---

## what's actually wrong

A sitemap the site declares cannot be fetched.

## threshold

**An absent sitemap is not a defect.** Nothing in the protocol or Google's
guidance requires one; Google discovers URLs by crawling. A small site with no
sitemap is not broken.

The finding requires a **declared** sitemap that fails:

| Condition | Severity |
|---|---|
| `Sitemap:` in robots.txt points at a URL returning 4xx | high — the site declares something that does not exist |
| declared sitemap returns persistent 5xx | high |
| declared sitemap URL is relative, not absolute (S18) | high — invalid, never fetched |
| declared sitemap returns 200 but is not XML | high — topic 25 territory once fetched |
| declared sitemap redirects | moderate — resolve and report the chain |
| no sitemap declared anywhere | **none.** Informational at most |

Transient 5xx is excluded by the re-fetch rule (topic 68) and belongs to
topic 3.

## detect

1. Read `Sitemap:` records from robots.txt (S19 — anywhere in the file,
   independent of user-agent groups).
2. Validate each is absolute (S18).
3. Fetch each. Record status, content type, size.
4. Re-fetch per topic 68 before raising any failure.

Note: a sitemap may also be submitted only through Search Console and not
declared in robots.txt. Absence from robots.txt is topic 28, not this topic,
and does not mean no sitemap exists.

## fix

- **relative URL** → rewrite as absolute. Deterministic, single line.
- **4xx / 5xx / non-XML** → no repo transform for the fetch failure itself.
  Report. If the file simply does not exist at that path, either the path or
  the declaration is wrong, and which is correct is intent.
- **redirect** → repoint the declaration at the final URL.

## postcondition

Live: every `Sitemap:` URL in robots.txt is absolute and returns 200 with an
XML content type in zero redirects.

## idempotent?

Yes.

## risk / blast radius

`robots.txt` or the `robots.ts` route. Small for the declaration itself, but
the file governs the whole origin — see topic 22.

## rollback

Revert.

## verdict

`auto-fixable` for converting a relative `Sitemap:` URL to absolute, and for
repointing a declaration at a redirect's final target.

`human-review` for a declared-but-missing sitemap. `not_mechanically_fixable`
for persistent 5xx.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | No sitemap declared at all | not a defect. Never raise |
| 2 | Sitemap submitted via Search Console only | not missing. Topic 28 at most |
| 3 | 5xx observed once | re-fetch first (topic 68); transient is topic 3 |
| 4 | Sitemap on another origin with established cross-submission | valid (S22). Never raise |
| 5 | robots.txt itself unreachable | topic 22 first — the declaration cannot be read |
| 6 | Sitemap index declared instead of individual sitemaps | sufficient (S21). Never raise |

### Explicitly rejected

- **Generating a sitemap where none exists.** Absence is not a defect, so
  there is no finding behind the change. Same reasoning as topic 13.
- **Treating a 404 sitemap the same as a 404 robots.txt.** A 404 robots.txt is
  normal (topic 22); a 404 at a declared sitemap URL is not.

## fixture

robots.txt with a relative `Sitemap:` line; with an absolute URL returning
404; with a URL returning 200 XML; with no `Sitemap:` line; with a sitemap
index; with a URL returning a single transient 5xx.

CI asserts: auto-fix for the first; human-review for the second; nothing for
the third, fourth and fifth; routed to topic 3 for the sixth.

## Cross-references

- topic 22 robots.txt validity; topics 25, 26, 27, 28; topics 3, 68
