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

      const topic8 = allEmits.filter((e) => e.topicId === '8')
      const t8Actionable = listedActionable.filter((f) => f.topicId === '8')
      const t8Generated = topic8.filter(
        (e) => e.verdict === 'informational-generated-only',
      )
      const t8AutoRedirect = topic8.filter((e) => e.verdict === 'auto-redirect')
      const t8Blast = topic8.filter(
        (e) => e.verdict === 'human-review-blast-radius',
      )
      const t8Absent = topic8.filter(
        (e) => e.verdict === 'human-review-preferred-absent',
      )
      // Site-wide trailingSlash must never auto-redirect
      expect(t8AutoRedirect).toHaveLength(0)
      // Rolled findings name the resolved routing artefact (vercel.json for Vite/static)
      for (const f of t8Actionable) {
        expect(f.declarationSite ?? f.rollupKey).toMatch(
          /vercel\.json|next\.config|config:/,
        )
      }

      const topic26 = listedActionable.filter((f) => f.topicId === '26')
      const t8PreferredConflict = t8Actionable.filter(
        (f) => f.verdict === 'human-review-preferred-conflict',
      )
      const linkedRootCause = t8PreferredConflict.filter((f) => {
        const related = f.evidenceValues?.relatedFindings
        return (
          Array.isArray(related) &&
          related.some(
            (r) =>
              r &&
              typeof r === 'object' &&
              (r as { topicId?: string }).topicId === '26',
          )
        )
      })
      // Topic 26 canonical-elsewhere on a preferred-form twin must not stay
      // separately actionable when topic 8 preferred-conflict covers the family.
      expect(
        listedActionable.every(
          (f) =>
            !(
              f.topicId === '26' &&
              f.verdict === 'human-review-canonical-elsewhere' &&
              linkedRootCause.length > 0
            ),
        ),
      ).toBe(true)

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

## 3. Topic 8 rollup + discoverability + auto-redirect

| Cause | Emit count | Notes |
|-------|------------|-------|
| informational-generated-only | ${t8Generated.length} | peer not in crawl/sitemap/links |
| human-review-blast-radius | ${t8Blast.length} | site-wide trailingSlash/cleanUrls |
| human-review-preferred-absent | ${t8Absent.length} | no site preferred-form signals |
| auto-redirect | ${t8AutoRedirect.length} | must be 0 (site-wide → human-review) |

List actionable topic 8 (after rollup to resolved routing config):
${
  t8Actionable.length === 0
    ? '_None_'
    : t8Actionable
        .map(
          (f) =>
            `- \`${f.verdict}\` · ${f.affectedUrlCount} URL(s) · site=${f.declarationSite ?? '(none)'} · ${f.pageUrl ?? ''}`,
        )
        .join('\n')
}

## 4. Topic 26 + cross-topic root cause

\`/blog\` HTML canonical → \`https://autodun.com/blog/index.html\` (index.html
variant of the sitemap loc). Topic 26 \`human-review-canonical-elsewhere\` and
topic 8 \`human-review-preferred-conflict\` share one preferred-form decision —
topic 8 is primary; topic 26 is related evidence, not a separate actionable row.

Linked preferred-form primaries (topic 8 with related topic 26): ${linkedRootCause.length}
${
  linkedRootCause.length === 0
    ? '_None_'
    : linkedRootCause
        .map((f) => {
          const related = (f.evidenceValues?.relatedFindings ?? []) as Array<{
            topicId?: string
            verdict?: string
            pageUrl?: string
          }>
          return `- primary topic 8 \`${f.verdict}\` · ${f.pageUrl}\n${related
            .map(
              (r) =>
                `  - related topic ${r.topicId} \`${r.verdict}\` · ${r.pageUrl ?? ''}`,
            )
            .join('\n')}`
        })
        .join('\n')
}

List-API actionable topic 26 (must be 0 when linked): ${topic26.length}
${topic26.map((f) => `- \`${f.verdict}\` · ${f.pageUrl}`).join('\n') || '_None_'}

## 5. Detector wiring (shipped-but-unwired = 0)

Wired count: ${WIRED_TOPIC_IDS.length} / shipped ${Object.keys(DETECTOR_SCOPE_BY_TOPIC).length}.
Unshipped reserved: topic 58 = ${UNSHIPPED_DETECTOR_SCOPE['58']}.

| Topic | DETECTOR_SCOPE | Crawl call |
|-------|----------------|------------|
${wiringTable}

Post-crawl emit summary:
${wholeSiteSummary}

## 6. Topic 43

Topic 43 emits: ${topic43.map((e) => e.verdict).join(', ') || '(none)'}
Orphan findings raised: ${orphanFindings.length}

## Run

| Metric | Value |
|--------|-------|
| Status | ${result.status} |
| Partial | ${result.isPartial} |
| Duration | ${(result.durationMs / 1000).toFixed(1)}s |

## Counts

| Bucket | Live | Prior (wired 8–12) | Demo |
|--------|------|--------------------|------|
| actionable | ${result.counts.actionable} | 25 | 10 |
| informational | ${result.counts.informational} | 16 | 17 |
| internal (hidden) | ${result.counts.internal} | — | ${DEMO_RUN_META.internalCount} |

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
      // 8–12: topic 8 post-crawl; 9–12 chunk
      expect(allEmits.some((e) => e.topicId === '8')).toBe(true)
      for (const id of ['8', '24', '25', '27', '28', '43', '45'] as const) {
        expect(allEmits.some((e) => e.topicId === id)).toBe(true)
      }
      void buildDemoFindings
      void DEMO_RUN_META
    },
    600_000,
  )
})
