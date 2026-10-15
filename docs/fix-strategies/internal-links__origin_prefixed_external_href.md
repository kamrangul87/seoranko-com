# internal-links__origin_prefixed_external_href

Status: READY — auto-fixable
Topic: 74 of the issue register
Tier: A — HTML-only
Research title: origin_prefixed_external_href (topic 74).
Research date: 2026-10-14

---

## what's actually wrong

An `<a href>` resolves on the site's own host but the path embeds another
absolute URL (or a scheme-less host), e.g.
`https://example.com/https://www.gov.uk/…`. Crawlers treat that as a same-host
URL (usually 404). Topic 1 may only see a generic 404 if the target is fetched;
this detector names the malformation without a network round-trip.

## detect

Same-host resolved URL whose pathname starts with `http(s)://…` or `www.…`
(or contains an embedded absolute URL). Straight and curly attribute quotes
are both accepted (CMS paste).

## fix

Auto: rewrite the href to the embedded external URL (`auto-unwrap-origin-prefix`).
Supports straight and curly `href="…"` / `href=“…”` quotes.

## verdict

`auto-unwrap-origin-prefix` (auto-fixable). Legacy slug
`origin-prefixed-external-href` remains in owner-copy for older rows.
