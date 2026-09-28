# Change Monitoring — Stage 4 (master plan §3.4)

**Status:** Landing on `cursor/change-monitoring-digest-922c` (2026-09-28).

## Scope

What-changed digest between the latest terminal crawl and the previous one
(prefer prior `trigger=scheduled`), plus owner-facing partial-coverage reasons
that name URLs (fetch failure vs plan limit vs tick budget).

## Pieces

| Piece | Location |
|---|---|
| Digest builder | `src/lib/fix-strategies/findings-ui/crawl/what-changed.ts` |
| Partial coverage summary | `…/crawl/partial-coverage.ts` |
| Scheduled return + resume | `scheduled-recrawl.ts` → `whatChanged` |
| Findings list API | `src/app/api/fix-strategies/findings/route.ts` |
| Findings UI banner + digest | `src/app/dashboard/findings/page.tsx` |
| Cron JSON | `/api/cron/scheduled-recrawl` → `partialCoverage` + `whatChanged` |
| Tests | `what-changed.test.ts`, `partial-coverage.test.ts` |

## Digest contents

- **New** — `firstSeenRunId === current`
- **Resolved** — `status=resolved`, `lastSeenRunId !== current`, has `resolvedAt`
- **Regressed** — `status=regressed` and `lastSeenRunId === current` (includes PR ref when SEORANKO fixed it)
- **Still open** — open + regressed count

No rankings, traffic, or invented severity.

## Partial coverage (Autodun gap class)

`urlsCrawled` counts successful HTML assessments only. HTTP ≥400 jobs are
`failed` with `fetch_failure` notes. A 19-found / 15-crawled / 4×404 run is
**partial because of fetch failures**, not plan limit or tick budget — and
those four URLs **are assessed**, so resolution can fire for findings on them.

Never-reached (still queued / never claimed) URLs remain unassessed; findings
on those pages stay open until a later run touches them. The UI must say which
bucket applies.

## Acceptance

1. Unit: digest new/resolved/regressed; partial summary names 404 URLs.
2. Findings list exposes `whatChanged` when latest run is terminal.
3. Cron results include `partialCoverage.headline` + compact `whatChanged`.

## Not in this stage

Email/Slack digest delivery; ranking/traffic deltas.
