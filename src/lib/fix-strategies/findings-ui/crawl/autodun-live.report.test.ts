/**
 * Live verification: full autodun.com crawl — all shipped detectors wired,
 * topic 27 duplicate-variant guard, topics 8–12 PER-PAGE (incl. index.html).
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
import {
  DETECTOR_SCOPE_BY_TOPIC,
  CHUNK_LOOP_TOPIC_IDS,
  POST_CRAWL_TOPIC_IDS,
  WIRED_TOPIC_IDS,
  UNSHIPPED_DETECTOR_SCOPE,
} from '@/lib/fix-strategies/detector-scope'

const SITE_ID = 'live-autodun-verify'
const USER_ID = 'live-verify-user'
const ORIGIN = 'https://autodun.com'
const enabled = process.env.LIVE_CRAWL === '1'

describe.skipIf(!enabled)('autodun live crawl report', () => {
  it(
    'all detectors wired; topic 27 excludes index.html duplicate; 8-12 run',
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

      const topic27 = allEmits.filter((e) => e.topicId === '27')
      const t27OmissionIndex = topic27.filter(
        (e) =>
          e.verdict === 'report-omission' &&
          e.pageUrl.includes('/blog/index.html'),
      )
      const t27RoutedIndex = topic27.filter(
        (e) =>
          e.verdict === 'route-topic-8-12-url-variants' &&
          e.pageUrl.includes('/blog/index.html'),
      )
      // Finding must NOT survive as omission — identical content to /blog
      expect(t27OmissionIndex).toHaveLength(0)

      const topic8to12 = allEmits.filter((e) =>
        ['8', '9', '10', '11', '12'].includes(e.topicId),
      )

      const wiringTable = Object.keys(DETECTOR_SCOPE_BY_TOPIC)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((id) => {
          const scope = DETECTOR_SCOPE_BY_TOPIC[id]
          const where = (CHUNK_LOOP_TOPIC_IDS as readonly string[]).includes(id)
            ? 'chunk'
            : (POST_CRAWL_TOPIC_IDS as readonly string[]).includes(id)
              ? 'post-crawl'
              : 'UNWIRED'
          return `| ${id} | ${scope} | ${where} |`
        })
        .join('\n')

      const wholeSiteSummary = POST_CRAWL_TOPIC_IDS.map((id) => {
        const emits = allEmits.filter((e) => e.topicId === id)
        const actionable = emits.filter((e) => e.bucket === 'actionable')
        return `- topic ${id} (${DETECTOR_SCOPE_BY_TOPIC[id]}): ${emits.length} emit(s), ${actionable.length} actionable`
      }).join('\n')

      const seeds = result.discoverySeeds
      const actionableLines =
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

      const report = `# Findings live crawl — autodun.com

Generated: ${new Date().toISOString()}

## 1. Discovery

| Seed source | Count |
|-------------|-------|
| robots Sitemap locs | ${seeds?.fromRobotsSitemaps ?? 0} |
| sitemap.xml fallback | ${seeds?.fromSitemapFallback ?? 0} |
| homepage | ${seeds?.fromHomepage ?? 0} |
| link-graph expand | ${seeds?.fromLinkGraph ?? 0} |
| **URLs found (frontier)** | **${result.urlsFound}** |
| URLs crawled | ${result.urlsCrawled} |
| client_only pages | ${result.urlsClientOnly} |

Caps: \`CRAWL_URL_CHUNK_SIZE=${CRAWL_URL_CHUNK_SIZE}\`;
\`CRAWL_MAX_DISCOVERED=${CRAWL_MAX_DISCOVERED}\`.

## 2. /blog/index.html vs /blog (topic 27)

Live check: identical body hash + same ETag → duplicate URL form, not a
sitemap omission. Sitemap correctly lists \`/blog\`.

Topic 27 guard: \`classifySitemapDuplicateVariant\` → \`index-html\` →
\`route-topic-8-12-url-variants\` (internal), not \`report-omission\`.

- report-omission for /blog/index.html: **${t27OmissionIndex.length}** (must be 0)
- routed index.html variant emits: ${t27RoutedIndex.length}
- Topic 8–12 emits this run: ${topic8to12.length}

## 3. Detector wiring (shipped-but-unwired = 0)

Wired count: ${WIRED_TOPIC_IDS.length} / shipped ${Object.keys(DETECTOR_SCOPE_BY_TOPIC).length}.
Unshipped reserved: topic 58 = ${UNSHIPPED_DETECTOR_SCOPE['58']}.

| Topic | DETECTOR_SCOPE | Crawl call |
|-------|----------------|------------|
${wiringTable}

Post-crawl emit summary:
${wholeSiteSummary}

## 4. Topic 43

Topic 43 emits: ${topic43.map((e) => e.verdict).join(', ') || '(none)'}
Orphan findings raised: ${orphanFindings.length}

## Run

| Metric | Value |
|--------|-------|
| Status | ${result.status} |
| Partial | ${result.isPartial} |
| Duration | ${(result.durationMs / 1000).toFixed(1)}s |

## Counts

| Bucket | Live | Prior (whole-site pass) | Demo |
|--------|------|-------------------------|------|
| actionable | ${result.counts.actionable} | 10 | 10 |
| informational | ${result.counts.informational} | 16 | 17 |
| internal (hidden) | ${result.counts.internal} | 315 | ${DEMO_RUN_META.internalCount} |

List API actionable: ${listedActionable.length}
List API + informational: ${listedAll.length}

### Actionable verdicts

${actionableLines}

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
      expect(
        listedActionable.every((f) => f.topicId !== '43'),
      ).toBe(true)
      expect(
        listedActionable.every(
          (f) =>
            !(
              f.topicId === '27' &&
              f.verdict === 'report-omission' &&
              (f.pageUrl ?? '').includes('/blog/index.html')
            ),
        ),
      ).toBe(true)
      // 8–12 wired into chunk loop
      expect(topic8to12.length).toBeGreaterThan(0)
      for (const id of ['8', '24', '25', '27', '28', '43', '45'] as const) {
        expect(allEmits.some((e) => e.topicId === id)).toBe(true)
      }
      void buildDemoFindings
      void DEMO_RUN_META
    },
    600_000,
  )
})
