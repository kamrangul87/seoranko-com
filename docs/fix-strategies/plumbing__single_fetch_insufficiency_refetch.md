# plumbing__single_fetch_insufficiency_refetch

Status: READY — fallback interval values to be set as a product decision
Topic: 68 of the issue register
Tier: A (cross-cutting plumbing)
Blocks: 1–7
Research dates: 2026-09-10, 2026-09-14

---

## what this is

Not a user-facing finding. A precondition every status-based detector must
satisfy before it is allowed to raise anything. It answers one question: when
is a single observation enough, and when is it not.

## the governing principle

A status code is a claim about the *present*. Some codes additionally carry a
claim about *duration*, and that claim — not the code's severity — determines
whether one observation is sufficient evidence.

## primary source

- RFC 9110 (HTTP Semantics), Standards Track, June 2022 — https://www.rfc-editor.org/rfc/rfc9110.html
  - §15.5.5 (404), §15.5.11 (410), §15.6.4 (503), §10.2.3 (Retry-After)
- RFC 6585 (Additional HTTP Status Codes), April 2012 — https://datatracker.ietf.org/doc/html/rfc6585
  - §4 (429 Too Many Requests)

### Verified facts

| Fact | Source | Status |
|---|---|---|
| 404 does not indicate whether the absence is temporary or permanent | RFC 9110 §15.5.5 | verified |
| A 404 URL may later return 200 with no contradiction in HTTP semantics | RFC 9110 §15.5.5 (corollary) | verified |
| 410 means access is no longer available and the condition is *likely permanent*; where permanence is unknown, 404 ought to be used | RFC 9110 §15.5.11 | verified |
| 503 indicates a temporary overload or scheduled maintenance that will likely be alleviated after some delay | RFC 9110 §15.6.4 | PENDING — confirm against §15.6.4 text |
| 503 does **not** specify how long the unavailability lasts. Temporary ≠ known duration | RFC 9110 §15.6.4 | PENDING — confirm against §15.6.4 text |
| `Retry-After` on a 503 is **MAY**, not required | RFC 9110 §15.6.4 | PENDING — confirm against §15.6.4 text |
| `Retry-After` takes either delta-seconds or an HTTP-date | RFC 9110 §10.2.3 | verified |
| 429 is defined in RFC 6585 §4, not RFC 9110 | RFC 6585 §4 | verified |
| RFC 6585 *recommends* `Retry-After` with 429 — does not require it | RFC 6585 §4 | verified |
| `X-RateLimit-*` headers are widely adopted convention, standardised in no RFC | — | verified (absence of spec) |
| Google retries URLs returning 503/429 for about two days. Persisting beyond a few days can substantially reduce or stop crawling, and Google states responses beyond two days can cause URLs to be dropped from the index | Google Search Central, http-network-errors | PENDING — confirm exact wording |

The three PENDING rows are currently supported only by AI-generated summaries.
Two summaries agreeing is not evidence. One direct read of §15.6.4 closes them.

## threshold — evidence sufficiency by status

| Observed | Duration claim in the response | Sufficient on one observation? | Action |
|---|---|---|---|
| 410 | likely permanent, asserted by the server | **yes** | proceed to finding |
| 404 | none — silent on permanence | **no** | re-fetch before raising |
| 503 | explicitly temporary | **never** | retry; never raises a link finding |
| 429 | rate limited, transient | **never** | retry; never raises a link finding |
| 5xx other | server-side failure | **never** | retry; availability problem, not a link finding |
| network timeout / connection reset / DNS failure | no response at all | **never** | retry; never raises a finding |
| 200 | resolves | n/a | pass, subject to the soft-404 discriminator (topic 1) |

The asymmetry is the whole rule: **410 is the only non-200 status whose own
semantics license acting on a single observation**, because it is the only one
in which the server asserts permanence.

## re-fetch policy

1. **Honour `Retry-After` when present**, on both 429 and 503. Parse both
   forms — delta-seconds and HTTP-date. A malformed value is treated as absent,
   never as zero.
2. **Fall back to a fixed interval when the header is absent**, since it is
   optional on both codes.
3. **Cap total attempts** and cap the maximum honoured `Retry-After` value; a
   server may legitimately send a delay longer than a crawl window.
4. **A finding may only be raised when the same status is observed on both the
   initial fetch and the re-fetch.** Differing statuses across attempts mean
   the evidence is unstable — suppress and re-queue.
5. **Re-fetch must bypass caches** (`Cache-Control: no-cache` on the request),
   or a stale cached 404 at the CDN will simply be observed twice.

### What the Google two-day figure does and does not set

It does **not** set the re-fetch interval. Google's figure concerns when a
persistent outage costs a URL its index entry — measured in days. The
re-fetch interval here concerns whether a single observation is trustworthy —
measured in seconds. Different decisions.

Where it does apply: **topic 3 (5xx responses)**. It is the bound on how long
a 5xx must persist before the condition is a finding rather than noise. Record
it there, not as a threshold in this file.

Do not write "Google removes a URL after two days of 5xx" — too strong. Use
the retry-and-may-be-dropped wording above.

### Fallback interval — product decision, not a sourced threshold

Exponential backoff with jitter is an engineering convention, not a
specification. No RFC mandates an interval, a retry count, or a backoff curve.
Any number chosen here is a SEORANKO product decision and must be recorded as
such in `_sources.md` — never presented as spec-derived.

Values still to be set:

- fallback delay when `Retry-After` is absent
- maximum attempts
- maximum honoured `Retry-After`
- whether re-fetch happens in the same crawl or a later one

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | `Retry-After` present but malformed | treat as absent, use fallback — never as zero |
| 2 | `Retry-After` longer than the crawl window | cap it; do not block the crawl |
| 3 | Re-fetch served from cache | force cache bypass; otherwise the second observation is not independent |
| 4 | Initial and re-fetch statuses differ | suppress; evidence unstable |
| 5 | `X-RateLimit-*` headers present | informational only; never gate a decision on them |

### Explicitly rejected

- **Deriving a retry interval from a 503 alone.** The code claims the condition
  is temporary but says nothing about duration. Without `Retry-After` there is
  no server-supplied number to use.
- **Treating 429 or 5xx as a broken-link finding.** Both are availability
  conditions. The link may be perfectly valid.
- **Building on `X-RateLimit-*`.** Convention with no spec; absent on most
  sites and inconsistently named where present.

## consumers

Topics 1–7 must call this before raising. Topic 1 additionally depends on it
for guard 6 (stale cached 404).

## Open questions

1. ~~Does Google publish how long a failure must persist before it acts?~~
   **CLOSED 2026-09-14.** Google retries 503/429 for about two days. It does
   not set the re-fetch interval — see above. The fallback interval remains a
   product decision.
2. Confirm the three PENDING rows against RFC 9110 §15.6.4 directly.

## Cross-references

- topic 1 — broken internal links (guard 6, and the 410/404 branch rests on
  the same duration-claim asymmetry)
- topics 2–7 — all status-based detectors
- topic 3 — 5xx responses. Note the boundary: persistent 5xx *is* a finding in
  topic 3; it is never a finding in topics 1–2.
