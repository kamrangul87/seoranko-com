# duplicate-url__http_vs_https

Status: READY
Topic: 9 of the issue register
Tier: A
Template: topic 8
Research dates: 2026-09-15

---

## what's actually wrong

`http://` and `https://` forms of the same path both return 200 with the same
content.

## primary source

- Google, Canonicalization and how to specify a canonical URL —
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google, Redirects and Google Search —
  https://developers.google.com/search/docs/crawling-indexing/301-redirects

### Verified facts

| Fact | Status |
|---|---|
| Google prefers HTTPS pages over equivalent HTTP pages as canonical | verified |
| Exceptions where Google will not prefer the HTTPS form: invalid TLS certificate, insecure dependencies on the page, HTTPS redirecting to HTTP, an HTTPS canonical pointing at an HTTP URL | verified |
| HTTPS should also be used in canonicals, internal links, sitemaps and hreflang | verified |
| HSTS is an additional measure, not a canonicalization fix | verified |

**Not adopted:** HTTPS as a "strong ranking signal", and equity-splitting
claims. Unsourced.

## threshold

Both protocol forms return 200 with the same content, **and** none of the four
documented exceptions apply.

**This topic differs from topics 8, 10 and 11: the preferred form is known.**
Google states a preference, so the agent does not need to derive it from site
signals. HTTPS is the target.

## detect

1. For each crawled HTTPS 200 URL, fetch the `http://` form.
2. If it 3xx-redirects to HTTPS, the site already normalises — no finding.
3. If it returns 200 with the same content, candidate.
4. Check the four exceptions before raising.
5. Re-fetch per topic 68.

## fix

Permanent redirect `http://` → `https://`, site-wide.

Also required for the fix to be complete: canonicals, internal links and
sitemap entries use the HTTPS form. A redirect alone leaves the site pointing
at URLs that now redirect (topic 42).

## postcondition

Live: the HTTP form returns 301/308 to the HTTPS form, which returns 200 in
one hop with a self-referential HTTPS canonical.

## idempotent?

Yes.

## risk / blast radius

Site-wide. Host-level or build config.

## rollback

Revert. A 301 may be browser-cached; HSTS, if enabled, cannot be undone by a
revert within its max-age.

## verdict

`auto-fixable` where the HTTPS form is healthy, none of the four exceptions
apply, and the redirect is a plain config change. This is the one duplicate-URL
topic with a documented preferred form, so the preference is not a guess.

`human-review` otherwise.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | TLS certificate is invalid or expired on the HTTPS form | never redirect to it. Report the certificate problem instead |
| 2 | HTTPS page loads insecure dependencies | human-review; fixing the redirect alone leaves mixed content |
| 3 | HTTPS redirects to HTTP | contradictory config. Human-review, report both rules |
| 4 | An HTTPS canonical points at an HTTP URL | human-review; the canonical must be fixed with the redirect |
| 5 | The two forms serve different content | not a duplicate |
| 6 | HTTP already redirects to HTTPS | site normalises. Never raise |

### Explicitly rejected

- **Enabling HSTS as part of the fix.** It is not a canonicalization measure
  and it is effectively irreversible for the max-age window.
- **`robots.txt` or `noindex` on the HTTP form.** Not canonicalization fixes;
  blocking crawl prevents Google seeing the canonical.

## fixture

Both forms 200 identical; HTTP already redirecting; HTTPS with an invalid
certificate; HTTPS canonical pointing at HTTP; both forms serving different
content.

CI asserts: raised for the first; suppressed for the second and fifth;
human-review for the third and fourth.

## Cross-references

- topic 8 (template), 10, 11, 12
- topics 13–18 canonical
- topic 27 sitemap, topic 42 internal links
