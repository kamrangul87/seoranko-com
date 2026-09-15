# duplicate-url__uppercase_vs_lowercase

Status: READY
Topic: 11 of the issue register
Tier: A
Template: topic 8
Research dates: 2026-09-15

---

## what's actually wrong

`/Apple` and `/apple` both return 200 with the same content.

## primary source

- Google, URL structure best practices —
  https://developers.google.com/search/docs/crawling-indexing/url-structure
- Google, Canonicalization and how to specify a canonical URL —
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls

### Verified facts

| Fact | Status |
|---|---|
| Google treats `/APPLE` and `/apple` as distinct URLs with their own content | verified |
| This applies to the **path**. Hostnames are case-insensitive | verified |
| Where the server serves both path variants identically, Google recommends converting URLs to consistent casing | verified |

## threshold

Both case variants return 200 **with the same content**, proving the server is
case-insensitive for that path.

**Content equivalence is not optional here — it is the whole finding.** A
case-sensitive server may serve genuinely different resources at `/Apple` and
`/apple`, and there is no way to tell which kind of server you are on except
by comparing the responses.

## detect

1. For each crawled 200 URL with any uppercase path character, fetch the
   lowercased form (path only — never touch the host).
2. Also test the reverse where the crawled URL is all-lowercase and an
   uppercase variant appears in the site's own links.
3. Both 200 with same content → candidate.
4. Re-fetch per topic 68.

## fix

Redirect the non-canonical casing to the established casing, where the repo or
server establishes one valid form.

## postcondition

Live: the non-preferred casing returns 301/308 to the preferred casing, which
returns 200 in one hop.

## idempotent?

Yes.

## risk / blast radius

Redirect rule in build config — site-wide if expressed as a pattern.

## verdict

`human-review`. The blast radius of getting this wrong is high: a
lowercasing rule applied to a case-sensitive server breaks every URL whose
correct form contains uppercase.

`auto-fixable` only for a single specific URL pair, both proven 200 with
identical content, with the canonical casing established in the repo route.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | The two variants serve **different** content | case-sensitive server. Never raise, never redirect |
| 2 | Lowercasing applied to the hostname | wrong operation. Hosts are case-insensitive; only paths are at issue |
| 3 | A blanket lowercase rule proposed instead of a specific pair | reject. See rejected below |
| 4 | Query-string values contain meaningful case (tokens, IDs, base64) | never lowercase query strings |
| 5 | One variant already redirects to the other | site normalises. Never raise |
| 6 | Encoded characters differ in case (`%2F` vs `%2f`) | percent-encoding case is not path case. Out of scope |

### Explicitly rejected

- **Blindly lowercasing all paths.** The single most damaging possible fix in
  this topic. Case-sensitive servers map `/Apple` and `/apple` to different
  resources, and a blanket rule 404s every correctly-uppercase URL.
- **Lowercasing host and path in one operation.** Different rules apply.
- **`robots.txt` or `noindex` on the variant.** Not a canonicalization fix.

## fixture

`/Apple` and `/apple` both 200 identical; both 200 with different content;
`/Apple` already redirecting; a URL with uppercase in the query string; a
mixed-case host.

CI asserts: raised for the first only; suppressed for the rest, with the
different-content case explicitly recorded as a case-sensitive server.

## Cross-references

- topics 8 (template), 9, 10, 12
- topic 5 — normalisation must not collapse case when detecting loops
