# crawlability__zero_raw_crawlable_anchors

Status: READY — report-only
Topic: 73 of the issue register
Tier: A — HTML-only
Research title: zero_raw_crawlable_anchors (topic 73).
Research date: 2026-10-14

---

## what's actually wrong

The HTTP response HTML for the homepage (or a high-impression page) contains
zero crawlable `<a href>` links. Googlebot does not execute page JavaScript to
discover links; if the pre-JS document has none, internal discovery from that
page stalls.

## threshold

- Scope: homepage, or URL with Search impressions ≥ product floor (topic 59).
- Emit when crawlable `<a href>` count in **raw** HTML is 0.
- Evidence always records raw count vs rendered count (when headless ran).

## fix

None automatic. Add real `<a href>` links in server-rendered HTML.

## verdict

`zero-raw-crawlable-anchors`, report-only, never promises indexing.
