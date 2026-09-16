# Open questions — fix-strategies register

Consolidated from dossier "Open questions" sections so gaps stay visible in
one place. Topic numbers in parentheses. Do not invent answers here — close
items in the owning dossier and strike or mark CLOSED below.

Last consolidated: 2026-09-16

---

## GSC / indexing reports

- **(GSC shared / 55–58)** Re-verify whether `CoverageState` in the current
  API still returns "Not Found (404)" for 410 URLs, and whether it reliably
  distinguishes indexed from not-indexed. Earlier observation predates this
  pass. Source: `_gsc_shared_facts.md`.

## Soft 404 / status

- **(1, 2)** Confirm which Google page carries the soft-404 definition when
  citing it. Topic 2's dossier now points at `_sources.md` row 27 for the
  2xx/soft-404 wording; keep the citation stable if the URL moves again.
  Source: `broken-internal-link__target_returns_4xx.md`.
- **(1)** Guards 2 and 3 (auth-protected / WAF 404) remain unverified —
  flag-only until a primary source exists.
- **(3)** Set the observation window for `persistent-5xx` as a documented
  product decision (`persistent5xxObservationWindowMs` in
  `product-decisions.ts` — still `null`). Until set: topic 26 / short evidence
  may use **`stableAcrossRefetch`** (5xx stable across the topic-68 re-fetch
  pair); do not call that `persistent`. Source: `status__5xx_responses.md`,
  `sitemap__urls_return_4xx.md`.

## Evidence / plumbing

- **(42)** Guard 2 (conditional redirects: auth, locale, device, geo, A/B) —
  only **locale path-swap** is statically detectable from a single Location
  hop (e.g. `/products` → `/en/products`). Auth, device, geo and A/B redirects
  need multi-request evidence the product does not gather — a known coverage
  boundary. Source: `internal-links__pointing_at_redirects.md`.
- **(68)** Confirm the three PENDING rows against RFC 9110 §15.6.4 directly
  (Retry-After MAY on 503, etc.). Fallback interval remains a product
  decision. Source: `plumbing__single_fetch_insufficiency_refetch.md`.
- **(67)** Should SEORANKO acquire a rendered-DOM fetch mode at all, or stay
  served-HTML-only and report `client-only` honestly? A rendering pipeline is
  a large dependency; honest reporting may suffice for every Tier A topic.
  Product decision. Source: `plumbing__pre_hydration_crawl_false_findings.md`.
- **(67)** Guards 11–14 (cookies/storage, WebSocket/WebRTC, robots-blocked
  resources) — whether they become a finding of their own or a variant within
  topics 2 and 60 is undecided.
- **(70)** Can middleware `matcher` scope / `rewrite()` calls be resolved
  statically often enough to narrow `indeterminate`? **Partially answered:**
  keying off `rewrite()` calls rather than middleware file presence is already
  implemented; usefulness on real middleware still open. Source:
  `plumbing__repo_to_url_site_model.md`.
- **(70)** Does topic 70 need a Pages Router scope note? It currently assumes
  App Router; the product is universal.

## Head / social

- **(32)** Twitter/X Card specification — required properties, and whether
  `twitter:*` tags are still honoured or fall back to Open Graph. Needs its
  own research pass before any threshold is set. Status on the dossier:
  Twitter Card portion NOT RESEARCHED.

## Structured data

- **(39)** Deprecation table maintenance cadence (proposed: weekly with
  documentation-updates feed). Which other types have had rich-result support
  withdrawn is not fully enumerated — only `HowTo` and `FAQPage` are verified.

## Tier C / performance-adjacent

- **(62)** Dedicated research pass still needed for: (1) any Google-documented
  crawling/rendering consequence of render-blocking resources distinct from
  user-performance; (2) whether WRS has a documented resource timeout;
  (3) whether `async`/`defer` correctness can be proven statically in any
  narrow case. Refusal stands until then.

## Intentionally empty / not researched (do not fill)

| Topic | File | Status |
|---|---|---|
| 44 | `internal-links__missing_destination_routes.md` | NOT RESEARCHED |
| 54 | `performance__missing_security_compression_headers.md` | NOT RESEARCHED |
| 69 | `plumbing__final_url_definition.md` | NOT RESEARCHED |
| 40 | `remove-dead-anchors.md` | stub / open questions empty |

---

## Closed (retained for audit trail)

- **(1)** `notFound()` status on Vercel / Next.js streaming — CLOSED 2026-09-10.
- **(1)** Soft-404 vs deliberate-noindex discriminator — CLOSED 2026-09-10
  (site model).
- **(68)** Google persistence window before acting on failures — CLOSED
  2026-09-14 (retries ~two days; does not set SEORANKO re-fetch interval).
- **(70)** `noindex` declaration sites — CLOSED 2026-09-14.
- **(2)** Soft-404 open questions section — none remaining in dossier body.
