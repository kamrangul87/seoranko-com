# Stage 1 report — topic 67 stream-completion guard

Date: 2026-09-16
Branch: `cursor/fix-strategies-audit-impl-922c`

## Built

- `readResponseBodyToCompletion` — consumes the response body stream to the
  end; mid-stream errors yield `streamComplete: false` with any partial bytes.
- `fetchUrl` — always records `streamComplete` on HTTP and network outcomes.
- `requireCompleteStream` / `probeContentSignals` — content/link/metadata/SD
  probes **refuse** incomplete reads (`stream_incomplete`) instead of
  classifying a prefix.
- Served-HTML presence: missing signals after a **complete** stream are
  `client_only`, not `absent` (rendered-DOM mode still an open product
  question).

## Tests asserted

Fixture pair in `src/lib/fix-strategies/fetch/fetch.test.ts`:

1. Multi-chunk stream with title, description, JSON-LD, body text, and an
   `<a href>` in later chunks → **zero** content/link/metadata/SD findings.
2. Genuinely empty complete HTML → all four finding kinds, each with
   `presence: client_only`.
3. Truncated mid-stream body → detectors refuse (`stream_incomplete`).

All 20 fetch-layer tests pass.

## Autodun root probe

Live `fetchUrl('https://autodun.com/')` via `scripts/autodun-stream-probe.mts`
(2026-09-16):

| Metric | Complete-stream value |
|---|---|
| status | 200 |
| streamComplete | true |
| bytes | 2497 |
| visible words (script/style stripped) | **28** |
| `<a href>` anchors | **false** (0) |
| `<title>` | present (shell) |

**Conclusion:** matches dossier step 3, not step 2. The homepage is a
near-empty served shell (Vite-style); the earlier "thin content: 28 words"
figure is the **complete** stream word count, not a truncated prefix.
Orphaned (0 anchors) and render-blocking inventory of that shell are the same
class. Under R7/R28 these are `client_only`, not content defects — suppress
the three stuck findings; do not ship three content fixers. A rendered-DOM
fetch mode remains an open product question (`_open-questions.md` / topic 67).

No customer-repo autofix for topic 67; this is SEORANKO fetch plumbing only.

## Dossier notes

Nothing in `plumbing__pre_hydration_crawl_false_findings.md` contradicted by
implementation. Open questions (rendered-DOM mode; guards 11–14 ownership)
remain in `_open-questions.md` — not decided here.
