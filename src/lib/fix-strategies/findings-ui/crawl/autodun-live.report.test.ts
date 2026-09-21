/**
 * Live verification: full autodun.com crawl with sitemap+robots+link-graph
 * discovery and topic 43 client_only-limited guard.
 *
 * Run: LIVE_CRAWL=1 npx vitest run src/lib/fix-strategies/findings-ui/crawl/autodun-live.report.test.ts
 */

import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CRAWL_URL_CHUNK_SIZE,
  CRAWL_MAX_DISCOVERED,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
  runCrawlToCompletion,
} from './index'
import { DEMO_RUN_META, buildDemoFindings } from '../demo-run'
import { classifyVerdictBucket } from '../buckets'

const SITE_ID = 'live-autodun-verify'
const USER_ID = 'live-verify-user'
const ORIGIN = 'https://autodun.com'
const enabled = process.env.LIVE_CRAWL === '1'

describe.skipIf(!enabled)('autodun live crawl report', () => {
  it(
    'discovers via sitemap+robots+link-graph; topic 43 client_only guard',
    async () => {
      resetMemoryFindingsStore()
      const store = useMemoryFindingsStore()

      const result = await runCrawlToCompletion({
        siteId: SITE_ID,
        userId: USER_ID,
        origin: ORIGIN,
        store,
      })

      const listedActionable = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: false,
      })
      const listedAll = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: true,
      })
      const allEmits = await store.listRunEmits(result.runId)
      const topic43 = allEmits.filter((e) => e.topicId === '43')
      const orphanFindings = topic43.filter((e) =>
        e.verdict.startsWith('finding-'),
      )
      const limited = topic43.filter((e) => e.verdict === 'client_only-limited')

      expect(orphanFindings).toHaveLength(0)
      expect(limited.length).toBeGreaterThan(0)
      expect(classifyVerdictBucket('client_only-limited')).toBe('informational')

      const seeds = result.discoverySeeds
      const report = `# Findings live crawl — autodun.com

Generated: ${new Date().toISOString()}

## 1. Discovery

Seeds from **robots.txt Sitemap: records**, **sitemap.xml locs**, the
**homepage**, and **crawlable \`<a href>\` expansion** during ticks (same-host
only). The previous "12" frontier was sitemap-only; the consolidation audit's
"16 nodes" was a homepage link-graph extract — not the same population.

| Seed source | Count |
|-------------|-------|
| robots Sitemap locs | ${seeds?.fromRobotsSitemaps ?? 0} |
| sitemap.xml fallback | ${seeds?.fromSitemapFallback ?? 0} |
| homepage | ${seeds?.fromHomepage ?? 0} |
| link-graph expand | ${seeds?.fromLinkGraph ?? 0} |
| **URLs found (frontier)** | **${result.urlsFound}** |
| URLs crawled | ${result.urlsCrawled} |
| client_only pages | ${result.urlsClientOnly} |

Caps: \`CRAWL_URL_CHUNK_SIZE=${CRAWL_URL_CHUNK_SIZE}\` (tick budget);
\`CRAWL_MAX_DISCOVERED=${CRAWL_MAX_DISCOVERED}\` (start-handler safety).

## 2. Topic 43 orphans vs client_only

Homepage served HTML has **0 \`<a href>\`** (SPA shell + JS bundle) → marked
\`client_only\`. \`/blog/uk-vehicle-data-tools.html\` and
\`/blog/ulez-checker-uk.html\` **are linked from \`/blog\` in served HTML**, but
because any crawled page is client_only, topic 43 **cannot** conclude
orphan-hood from served HTML alone (nav may also exist only after render on
the homepage).

Guard: \`hasClientOnlyPages\` → verdict \`client_only-limited\` (informational),
**not** \`finding-link-graph-orphan\`.

Topic 43 emits: ${topic43.map((e) => e.verdict).join(', ') || '(none)'}
Orphan findings raised: ${orphanFindings.length}

## Run

| Metric | Value |
|--------|-------|
| Status | ${result.status} |
| Partial | ${result.isPartial} |
| Duration | ${(result.durationMs / 1000).toFixed(1)}s |

## Counts (corrected vs demo)

| Bucket | Live (corrected) | Demo |
|--------|------------------|------|
| actionable | ${result.counts.actionable} | 10 |
| informational | ${result.counts.informational} | 17 |
| internal (hidden) | ${result.counts.internal} | ${DEMO_RUN_META.internalCount} |

List API actionable: ${listedActionable.length}
List API + informational: ${listedAll.length}

### Actionable verdicts

${
  listedActionable.length === 0
    ? '_None_'
    : listedActionable
        .map(
          (f) =>
            `- topic ${f.topicId} · \`${f.verdict}\` · ${f.affectedUrlCount} URL(s)${
              f.pageUrl ? ` · ${f.pageUrl}` : ''
            }`,
        )
        .join('\n')
}

Demo actionable count was 10 (incl. 1× topic-43 orphan). Live previously
showed 12 (+2 false orphans). Corrected: topic-43 orphans suppressed via
\`client_only-limited\`.

Coverage notes:
${result.coverageNotes.map((n) => `- **${n.code}**: ${n.detail}`).join('\n')}
`

      writeFileSync(
        resolve(process.cwd(), 'FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md'),
        report,
        'utf8',
      )

      expect(result.urlsFound).toBeGreaterThan(0)
      expect(result.urlsCrawled).toBeGreaterThan(0)
      expect(result.urlsClientOnly).toBeGreaterThan(0)
      // No actionable orphans
      expect(
        listedActionable.every((f) => f.topicId !== '43'),
      ).toBe(true)
      void buildDemoFindings
      void DEMO_RUN_META
    },
    300_000,
  )
})
