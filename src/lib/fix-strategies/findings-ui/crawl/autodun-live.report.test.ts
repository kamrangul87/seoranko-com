/**
 * Live verification: crawl autodun.com → detectors → memory persist.
 * Run: LIVE_CRAWL=1 npx vitest run src/lib/fix-strategies/findings-ui/crawl/autodun-live.report.test.ts
 *
 * Writes FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md at repo root.
 */

import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CRAWL_URL_CHUNK_SIZE,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
  runCrawlToCompletion,
  getFindingsStore,
} from './index'
import { DEMO_RUN_META } from '../demo-run'

const SITE_ID = 'live-autodun-verify'
const USER_ID = 'live-verify-user'
const ORIGIN = 'https://autodun.com'
const enabled = process.env.LIVE_CRAWL === '1'

describe.skipIf(!enabled)('autodun live crawl report', () => {
  it(
    'crawls autodun.com and reports counts vs demo 10/17',
    async () => {
      resetMemoryFindingsStore()
      const store = useMemoryFindingsStore()

      const result = await runCrawlToCompletion({
        siteId: SITE_ID,
        userId: USER_ID,
        origin: ORIGIN,
        store,
        // Cap keeps agent runs bounded near the demo's 11-page sample.
        // Report notes the cap so partial coverage is explicit.
        maxUrls: 12,
      })

      const listedActionable = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: false,
      })
      const listedAll = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: true,
      })

      expect(listedActionable.every((f) => f.bucket === 'actionable')).toBe(true)
      expect(listedAll.every((f) => f.bucket !== 'internal')).toBe(true)

      const report = `# Findings live crawl — autodun.com

Generated: ${new Date().toISOString()}

## Chunk size

- **CRAWL_URL_CHUNK_SIZE = ${CRAWL_URL_CHUNK_SIZE}**
- Why: each URL does stream-complete fetch (topic 67) + topic-68 confirming
  re-fetch + multi-detector work (including image header probes). Five URLs
  fit a ~45s tick under Vercel Hobby \`maxDuration=60\` with backoff headroom;
  remaining URLs resume on the next \`/tick\`.

## Run

| Metric | Value |
|--------|-------|
| Origin | ${ORIGIN} |
| Run id | ${result.runId} |
| Status | ${result.status} |
| Partial | ${result.isPartial} |
| Duration | ${(result.durationMs / 1000).toFixed(1)}s |
| URLs discovered (capped) | ${result.urlsDiscovered} |
| URLs crawled | ${result.urlsCrawled} |
| Chunk size | ${CRAWL_URL_CHUNK_SIZE} |

## Counts (live vs demo)

| Bucket | Live | Demo |
|--------|------|------|
| actionable | ${result.counts.actionable} | 10 |
| informational | ${result.counts.informational} | 17 |
| internal (hidden) | ${result.counts.internal} | ${DEMO_RUN_META.internalCount} |

List API actionable rows: ${listedActionable.length}
List API with informational: ${listedAll.length}

## Coverage notes

${
  result.coverageNotes.length === 0
    ? '_None_'
    : result.coverageNotes
        .map((n) => `- **${n.code}**: ${n.detail}${n.url ? ` (${n.url})` : ''}`)
        .join('\n')
}

## Actionable verdicts (live)

${
  listedActionable.length === 0
    ? '_None_'
    : listedActionable
        .map(
          (f) =>
            `- topic ${f.topicId} · \`${f.verdict}\` · ${f.affectedUrlCount} URL(s)${
              f.declarationSite ? ` · ${f.declarationSite}` : ''
            }`,
        )
        .join('\n')
}

## Notes

- Detectors unchanged; this path only crawls, calls them, rolls up, and persists.
- Re-run upserts by \`(site, topic, rollup_key)\` and records observation runs.
- Internal-bucket rows are stored as evidence and never returned by the findings list API.
- This verification used \`maxUrls=12\` (near the demo's 11-page sample). A product
  crawl uses discovery up to \`CRAWL_MAX_DISCOVERED\` (100) and marks discovery caps
  as partial coverage.
`

      const outPath = resolve(
        process.cwd(),
        'FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md',
      )
      writeFileSync(outPath, report, 'utf8')

      // Sanity: crawl did real work
      expect(result.urlsDiscovered).toBeGreaterThan(0)
      expect(result.urlsCrawled).toBeGreaterThan(0)
      void getFindingsStore
    },
    300_000,
  )
})
