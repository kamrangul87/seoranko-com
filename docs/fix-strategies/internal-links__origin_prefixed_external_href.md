# internal-links__origin_prefixed_external_href

Status: READY — report-only
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
(or contains an embedded absolute URL).

## fix

None automatic. Correct the href to the external URL (or a real internal path).

## verdict

`origin-prefixed-external-href`, report-only.
