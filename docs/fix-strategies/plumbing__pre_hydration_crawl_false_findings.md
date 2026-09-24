# plumbing__pre_hydration_crawl_false_findings

Status: READY
Topic: 67 of the issue register
Tier: A (cross-cutting plumbing)
Blocks: 2, 43, 60, 62 — and constrains every content-reading detector
Shared facts: none (facts R1–R32 live in this dossier)
Research title: plumbing__pre_hydration_render_guard (topic 67).
Research date: 2026-09-15

---

## what this is

Not a user-facing finding. A **precondition on the fetch layer**: what counts
as "the page's content" before any detector is allowed to read it.

This is the only topic in the register whose conclusion **removes** findings.

## primary source

- Google, Understand JavaScript SEO basics —
  https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Google, Fix search-related JavaScript problems —
  https://developers.google.com/search/docs/crawling-indexing/javascript/fix-search-javascript
- Google, Dynamic rendering as a workaround —
  https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering
- Next.js, Server and Client Components —
  https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js, Loading UI and streaming —
  https://nextjs.org/docs/app/api-reference/file-conventions/loading

### Verified facts — how Google processes JavaScript

| # | Fact | Status |
|---|---|---|
| R1 | Google describes **three phases: crawling, rendering, indexing** | verified |
| R2 | Crawling: Googlebot fetches the URL and parses the HTTP response, including crawlable `<a href>` links | verified |
| R3 | Rendering: eligible pages enter a rendering queue; WRS uses headless **evergreen Chromium** to execute JavaScript | verified |
| R4 | Indexing: Google processes the **rendered** HTML for content, metadata, links, canonical signals and structured data | verified |
| R5 | **"Two waves of indexing" is not Google's current formal model.** Google does not document two guaranteed or separately timed indexing events | verified |
| R6 | Rendering may happen within seconds but can take longer | verified |
| R7 | **All 200 responses are normally queued for rendering** unless a robots directive prevents indexing | verified |
| R8 | Non-200 responses might not be rendered | verified |

**R5 and R7 together dismantle the usual premise.** The common worry — that
Google indexes pre-hydration HTML and may never come back — is not what Google
documents. All 200 responses are normally queued for rendering.

### Verified facts — WRS behaviour and limits

| # | Fact | Status |
|---|---|---|
| R9 | WRS executes JavaScript and examines the resulting rendered HTML | verified |
| R10 | It **extracts links again after rendering** | verified |
| R11 | It cannot render pages or resources blocked by robots.txt | verified (topic 21) |
| R12 | It may omit requests it considers unnecessary for essential content, such as analytics calls | verified |
| R13 | It does **not preserve cookies, Local Storage or Session Storage** between page loads | verified |
| R14 | It supports ordinary HTTP requests but **not WebSockets or WebRTC as the sole content source** | verified |
| R15 | It may aggressively cache JS and CSS and **may ignore their caching headers**; fingerprinted filenames are recommended | verified (matches P24, topic 53) |
| R16 | It can process JavaScript-injected metadata and structured data, though server-rendering important signals is safer | verified |
| R17 | It **may skip rendering when the original HTML contains `noindex`**; JavaScript must not be relied on to remove that directive | verified |
| R18 | Google recommends testing the rendered DOM via the URL Inspection Tool or Rich Results Test | verified |

**Not adopted: any WRS timeout figure.** "Roughly 5–20 seconds" has no
primary source. Google documents no execution timeout value.

### Verified facts — dynamic rendering

| # | Fact | Status |
|---|---|---|
| R19 | Google's wording: dynamic rendering **was a workaround and is not a recommended long-term solution** — more precise than "deprecated" | verified |
| R20 | In Google's terminology it means detecting crawlers and serving them pre-rendered HTML while users get a client-rendered app | verified |
| R21 | Google recommends server-side rendering, static rendering, or hydration instead | verified |
| R22 | It is generally **not cloaking** where crawler and user versions contain equivalent content; materially different content can be cloaking | verified |
| R23 | **Google's "dynamic rendering" is not Next.js's "dynamic rendering."** The latter means rendering a route per request — ordinary server rendering, unrelated to the bot-specific workaround | verified |

R23 is a terminology trap that will otherwise produce a nonsense finding on
every dynamically-rendered Next.js route.

### Verified facts — Next.js initial HTML

| # | Fact | Status |
|---|---|---|
| R24 | Pages and layouts are **Server Components by default** | verified |
| R25 | Next.js renders Server Components into the RSC payload, then uses it with Client Components to generate server-rendered HTML | verified |
| R26 | On a direct initial request, **both Server and Client Components can contribute HTML** | verified |
| R27 | **Using a Client Component does not inherently mean its content is missing from initial HTML** | verified |
| R28 | Content is absent only when created **after browser execution** — inside `useEffect`, after user interaction, or via a browser-only fetch | verified |
| R29 | Streaming sends layout, available content and fallback UI first; completed Server Component HTML follows **in later response chunks** | verified |
| R30 | The browser can insert streamed content before hydration completes. This remains server-rendered HTML, and Next.js states server streaming does not inherently harm SEO | verified |
| R31 | **A scanner must read the complete response stream, not merely the first network chunk** — otherwise it falsely classifies streamed content as JavaScript-only or absent | verified |
| R32 | After streaming begins, headers are committed; a later `notFound()` cannot set 404, and Next.js streams a `noindex` tag with a 200 response | verified (topic 1) |

## the threshold — what "the page's content" means

A detector may read page content only from a fetch that satisfies all of:

1. **The complete response stream has been read to completion** (R31). Not the
   first chunk, not a size-capped prefix, not a time-capped read.
2. The response is 200 (R7, R8).
3. Where content is still absent after the full stream, the detector records
   `content-may-be-client-only` rather than `content-absent`.

Condition 1 is the guard. Everything else follows from it.

## the three states, and why they are not interchangeable

| State | Meaning | Detector treatment |
|---|---|---|
| present in the complete served stream | server-rendered, whether from Server or Client Components (R26, R27) | read normally |
| absent from the complete stream, present after rendering | created after browser execution (R28) | `client-only`. Google normally renders it (R7), so **not a content defect** |
| absent both from the stream and after rendering | genuinely missing | a real finding for the owning topic |

The middle row is where false findings come from. Google queues all 200
responses for rendering (R7) and re-extracts links after rendering (R10), so
client-rendered content and links are not invisible to Google. A detector
that reports them as missing is wrong.

## Rendered-DOM measurement (product decision CLOSED 2026-09-24)

SEORANKO now runs a **render guard** on the fetch layer:

1. Fetch **raw HTTP** to stream completion (still required — R31).
2. Flag `render_needed` when the served body looks like a pre-hydration shell
   (thin body text, JS framework root with little text, noscript JS warnings).
3. When needed, fetch the **rendered DOM** (headless Chromium) and store
   `raw_html_hash`, `rendered_html_hash`, and `render_mode`
   (`http` | `rendered` | `render_failed`).
4. Content / link / meta detectors judge the **rendered DOM when available**.
   Transport detectors (status, robots, redirects) still judge raw HTTP.

**What did not change:** client-only content is still **not a Google defect**
(R7, R10). Findings must never claim Google cannot see client-rendered content.

**What did change:** a raw-only signal that disappears after render is a
**measurement artefact**, not an actionable fix. Emit informational
`RAW_RENDER_MISMATCH` (never actionable). When `render_mode = render_failed`,
suppress headline actionable verdicts for that URL and report coverage
(pages crawled / rendered / render failures).

## what this guard invalidates

Any detector that reads content, links, or metadata from a partial stream.
Specifically:

| Topic | What breaks without this guard |
|---|---|
| 2 (soft 404) | streamed content read as an empty page |
| 43 (orphan pages) | links in later chunks missed, pages wrongly orphaned |
| 45 (crawl depth) | same — depth computed on an incomplete link graph |
| 60 (thin content) | word count taken from the first chunk |
| 62 (render-blocking) | resource inventory incomplete |
| 29–34 (head integrity) | metadata in later chunks read as absent |
| 35–39 (structured data) | JSON-LD in later chunks read as absent |
| 13–18 (canonical) | a streamed canonical read as absent |

## the autodun hypothesis

The five stuck findings on autodun.com all target the site root, and three —
"thin content: 28 words", "orphaned", "render-blocking scripts" — are exactly
the signature of a partial-stream read (R31).

**Test, in this order:**

1. Fetch the root and read the stream to completion. Compare byte length and
   word count against the previous partial read.
2. If the content appears, the three findings are detector artefacts. Delete
   them and ship this guard — **one fix, not three fixers.**
3. If content is still absent, check whether it is produced in `useEffect` or
   by a browser-only fetch (R28). If so, it is `client-only`, still not a
   content defect (R7).
4. Only if absent after rendering too is any content finding real.

Note the earlier live run reported the homepage as a Vite shell with 0
anchors, which is consistent with step 3 rather than step 2. Both paths end
with the findings being suppressed, not fixed.

## fix

This guard is not a fix applied to a customer repo. It is a change to
SEORANKO's own fetch layer:

- read responses to stream completion before handing them to any detector
- record `stream-complete: true|false` on every fetch; a detector must refuse
  to run on an incomplete read rather than reading it anyway
- record `client-only` separately from `absent`
- carry both states through to the finding, so output can say "present after
  rendering" rather than "missing"

Where a detector needs the rendered DOM rather than the served HTML, that is a
second fetch mode and must be labelled as such in the finding (R18). The
render guard implements that mode; evidence rows record which representation
was judged.

## postcondition

For SEORANKO's own CI: a fixture serving a streamed response with content in a
later chunk must produce **zero** content, link, metadata or structured-data
findings. A fixture serving genuinely empty HTML must produce them.

That single pair of fixtures is the whole test.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Content absent from the first chunk | **read the full stream** (R31). Never conclude from a prefix |
| 2 | Content rendered by a Client Component | may still be in initial HTML (R26, R27). Never assume absence |
| 3 | Content produced in `useEffect` or a browser-only fetch | `client-only` (R28). Google normally renders it (R7) — not a defect. Measure rendered DOM when available; if raw looked empty and rendered is rich, emit informational `RAW_RENDER_MISMATCH` only |
| 4 | Links absent from served HTML | WRS re-extracts links after rendering (R10). Not invisible to Google. Prefer rendered link graph when render succeeded; raw-only orphans → `RAW_RENDER_MISMATCH`, not actionable |
| 5 | Next.js "dynamic rendering" treated as Google's dynamic-rendering workaround | **R23.** Unrelated concepts |
| 6 | Dynamic rendering reported as "deprecated" | R19 — "a workaround, not recommended long-term" |
| 7 | A WRS timeout value cited | no published figure |
| 8 | "Two waves of indexing" used as the model | **R5** — retired. Use the three phases |
| 9 | Response is non-200 | may not be rendered (R8). Do not expect rendered content |
| 10 | Original HTML contains `noindex` | rendering may be skipped (R17). JS cannot remove it |
| 11 | Content depends on cookies, Local Storage or Session Storage | WRS does not preserve them (R13). Genuinely invisible — this **is** a real finding |
| 12 | Content arrives only via WebSocket or WebRTC | not supported as a sole source (R14). Also a real finding |
| 13 | Content depends on a robots-blocked resource | topic 21 — real, and provable |
| 14 | Analytics or non-essential request missing from the render | WRS may omit them (R12). Never a finding |

Guards 11–13 are the inverse case and worth separating: they are the
situations where client-side rendering **does** genuinely hide content from
Google, and each is mechanically detectable.

### Explicitly rejected

- **Concluding anything about content from a partial stream.** R31. This is
  the defect this topic exists to prevent.
- **"Client Component means not in initial HTML."** R27.
- **The two-waves model.** R5.
- **Any WRS timeout figure.** Unsourced.
- **Conflating Next.js dynamic rendering with Google's.** R23.
- **Recommending dynamic rendering as a fix.** R19, R21 — Google recommends
  server or static rendering instead.
- **Treating client-rendered content as invisible to Google.** R7, R10.

## Open questions

See `_open-questions.md` (topic 67). Summary:

1. ~~Should SEORANKO acquire a rendered-DOM fetch mode?~~ **CLOSED 2026-09-24:**
   yes — render guard + `RAW_RENDER_MISMATCH` informational. Client-only remains
   not a Google defect; raw/rendered mismatches are measurement artefacts.
2. Guards 11–14 describe genuinely-hidden-content cases. Whether they become a
   finding of their own, or a variant within topics 2 and 60, is undecided.

**Autodun check (2026-09-16):** complete-stream root fetch is still ~28 words
and 0 anchors — step 3 (`client_only`), not step 2.

**Autodun check (2026-09-24):** render guard hydrates the Vite `#root` shell;
rendered DOM has hundreds of words and dozens of internal links. Thin/orphan
raw-only signals become informational `RAW_RENDER_MISMATCH`, not actionable.

## Cross-references

- topic 1 (R32, the streamed `notFound()` case); topics 2, 43, 45, 60, 62 —
  all blocked by this guard; topics 13–18, 29–39 — all read content and so
  depend on it; topic 21 (R11); topic 53 (R15 matches P24); topic 68
