# status__5xx_responses

Status: READY — report-only, no auto-fix
Topic: 3 of the issue register
Tier: C (detect yes, fix no)
Depends on: topic 68 (re-fetch rule)
Research dates: 2026-09-14

---

## what's actually wrong

A URL returns a 500-level status, or the request times out or fails to
connect. The server did not serve the page, so it cannot be indexed from that
crawl.

## primary source

- Google Search Central, How HTTP status codes and network/DNS errors affect
  Google Search — https://developers.google.com/search/docs/crawling-indexing/http-network-errors
- Google Search Console, Page indexing report — Server error (5xx) —
  https://support.google.com/webmasters/answer/7440203
- Google Search Console, Crawl stats report — host availability —
  https://support.google.com/webmasters/answer/9679690
- RFC 9110 §15.6.4 (503)

### Verified facts

| Fact | Status |
|---|---|
| Google's server-error category covers more than 500-level statuses: request timeouts, connectivity failures and server-unavailable / busy conditions fall in it too | verified |
| Where the server is overloaded, Googlebot returns later and crawls again — a single transient 5xx does not remove a URL | verified |
| Google advises not to return 503/429 for more than two or three days, or it can signal Google to crawl the site less frequently long-term; persistent 5xx responses eventually cause indexed URLs to be dropped | verified |
| GSC's Server error (5xx) report is **historical**: it reflects the crawl that produced the error, not the URL's current status. A live test can succeed while the report still shows the error | verified |
| Crawl stats reports server errors as an availability warning with approximate timing, which distinguishes one-off from recurring failures | verified |
| 503 indicates a temporary overload or scheduled maintenance that will likely be alleviated after some delay; the code carries no claim about how long that delay is (topic 68) | verified |

**Not adopted:** claims about immediate organic traffic loss, and all
WordPress/PHP/`.htaccess` diagnosis. Out of stack and unsourced.

## threshold

A single 5xx observation is never a finding (topic 68). The finding is
**reproducibility**, not occurrence:

- observed 5xx on initial fetch **and** on re-fetch → `persistent-5xx`, report
- differing statuses across attempts → `transient-5xx`, record, do not report
  as a site problem
- 5xx observed only in GSC, 200 on live fetch → historical. Report as a past
  crawl failure with the crawl date, never as a current fault

The observation window (how long a 5xx must persist to be called persistent)
is a **SEORANKO product decision**. No primary source publishes a figure for
general 5xx. Google's two-or-three-day 503/429 crawl-rate guidance is the
nearest anchor and should be cited as context, not as the threshold.

## detect

1. Fetch. Record status, timeout, connection reset and DNS failure as distinct
   outcomes — they are not interchangeable.
2. Re-fetch per topic 68, honouring `Retry-After` where present.
3. Classify as persistent, transient, or historical per the threshold above.

## fix

**None.** A 5xx is a runtime or infrastructure failure — database timeouts,
memory exhaustion, upstream gateway failures, fatal exceptions. There is no
deterministic transform from a 5xx observation to a repo change, and no
postcondition that can be asserted from a file edit.

## postcondition

n/a — no transform.

## verdict

`not_mechanically_fixable`. Detect and report with evidence: the status, the
re-fetch result, the classification, and the crawl date where the signal came
from GSC. Hand the human a specific task.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Single observation only | never report. Re-fetch first (topic 68) |
| 2 | Statuses differ across attempts | transient. Record, do not report as a fault |
| 3 | GSC shows 5xx but the live fetch returns 200 | historical. Report with the crawl date, never as current |
| 4 | 503 or 429 with `Retry-After` | honour it before concluding anything |
| 5 | Rate limiting triggered by SEORANKO's own crawl | back off; the crawler caused it |

### Explicitly rejected

- **Treating a 5xx as a broken-link finding in topics 1 or 2.** Availability
  problem; the link may be valid.
- **Attempting a repo fix.** No deterministic transform exists.
- **Reporting a GSC 5xx as a current fault.** The report is historical by
  design.

## fixture

Synthetic target returning: persistent 500 on both fetches; 503 on the first
fetch and 200 on the re-fetch; 503 with `Retry-After: 2`; a connection
timeout.

CI asserts: first reported as persistent, second recorded as transient and not
reported, third honours the header before classifying, fourth recorded as a
timeout and not as a 500.

## Open questions

1. Set the observation window for `persistent-5xx` as a documented product
   decision.

## Cross-references

- topic 68 — evidence rules; this topic is its main consumer
- topics 1, 2 — 5xx never raises a finding there
- topics 55–58 — the historical-report guard applies to every GSC-sourced
  signal, not just 5xx
