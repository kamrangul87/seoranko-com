# performance__missing_security_compression_headers

Status: **NOT RESEARCHED**
Topic: 54 of the issue register
Tier: A-minus (provisional)
Research title: perf__crawl_affecting_headers (topic 54).
Research date: —

---

## why this file exists empty

Topic 54 — "missing security/compression headers where they affect crawling" —
was **not covered by the 2026-09-15 performance-adjacent research pass**. The
pass covered image dimensions, lazy loading, LCP discovery, `font-display` and
caching (topics 49–53).

No threshold is set here, and none should be inferred from the adjacent
dossiers. Writing one from general knowledge would be exactly the failure the
source register exists to prevent.

## what the research needs to establish

1. Does Google document **any** effect of compression (`Content-Encoding`,
   Brotli/gzip) on crawling or rendering? Specifically whether uncompressed
   resources are a documented crawl concern or purely a user-performance one.
2. Does Google document any effect of security headers — `Content-Security-Policy`,
   `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options` —
   on Googlebot's ability to fetch or render? A CSP that blocks its own
   resources is the plausible mechanical case.
3. Is `Vary` handling documented, particularly `Vary: User-Agent` and its
   interaction with Googlebot?
4. Are there documented consequences for a wrong `Content-Type` on a resource
   Google needs to render?
5. HSTS is already noted as **out of scope for auto-fix** in topic 9 —
   effectively irreversible for its `max-age` window. Confirm that boundary
   holds here too.

## known constraints inherited from the block

- Tier A-minus rules apply: no LCP, CLS or INP claim is assertable.
- Any postcondition must be asserted against the **live response headers**,
  never against `next.config` or `vercel.json`.
- Header rules match by pattern and usually cover whole directories, so blast
  radius is wide by default.

## Cross-references

- topic 9 (HSTS boundary); topic 21 (robots-blocked resources); topic 53
  (caching headers, and the live-response assertion rule); topic 62
