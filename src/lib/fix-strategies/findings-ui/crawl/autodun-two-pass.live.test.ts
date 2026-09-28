/**
 * Two-pass live autodun crawl — completion + resolution.
 *
 * Run: LIVE_CRAWL=1 npx vitest run src/lib/fix-strategies/findings-ui/crawl/autodun-two-pass.live.test.ts
 */
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
  runCrawlToCompletion,
} from './index'

const SITE_ID = 'live-autodun-resolve-check'
const USER_ID = 'live-verify-user'
const ORIGIN = 'https://autodun.com'
const enabled = process.env.LIVE_CRAWL === '1'

describe.skipIf(!enabled)('autodun two-pass completion + resolution', () => {
  it(
    'pass1 finishes; pass2 can resolve absent findings for assessed URLs',
    async () => {
      resetMemoryFindingsStore()
      const store = useMemoryFindingsStore()

      const r1 = await runCrawlToCompletion({
        siteId: SITE_ID,
        userId: USER_ID,
        origin: ORIGIN,
        store,
      })
      const run1 = await store.getRun(r1.runId)
      expect(run1).not.toBeNull()
      expect(['complete', 'partial']).toContain(run1!.status)
      expect(run1!.finishedAt).not.toBeNull()
      expect(run1!.status).not.toBe('running')

      // Seed a synthetic open finding on a URL pass1 assessed. Pass2 will
      // crawl that URL again without re-emitting this verdict → must resolve.
      const jobs1 = await store.listJobsForRun(r1.runId)
      const assessed = jobs1.find((j) => j.status === 'crawled')
      expect(assessed).toBeTruthy()
      const seedUrl = assessed!.finalUrl || assessed!.url
      await store.upsertFindings({
        siteId: SITE_ID,
        userId: USER_ID,
        runId: r1.runId,
        findings: [
          {
            topicId: '13',
            kind: 'canonical/tag-absent',
            verdict: 'auto-add-canonical',
            severity: 'medium',
            detail: 'seed for resolution proof',
            pageUrl: seedUrl,
            declarationSite: null,
            rollupKey: `13|auto-add-canonical|${seedUrl}|resolution-seed`,
            affectedUrlCount: 1,
            rolledUp: false,
            bucket: 'actionable',
            autoFixable: true,
            reportOnly: false,
            surfaceClass: 'auto-fixable',
            proposedDiff: null,
            evidenceValues: null,
            sourceRows: [],
          },
        ],
        internalEvidence: [],
      })

      const before = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: false,
      })
      expect(before.some((f) => f.verdict === 'auto-add-canonical')).toBe(true)

      const r2 = await runCrawlToCompletion({
        siteId: SITE_ID,
        userId: USER_ID,
        origin: ORIGIN,
        store,
      })
      const run2 = await store.getRun(r2.runId)
      expect(['complete', 'partial']).toContain(run2!.status)
      expect(run2!.finishedAt).not.toBeNull()

      const after = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: true,
      })
      const resolved = after.filter((f) => f.status === 'resolved')
      const seedResolved = resolved.filter(
        (f) => f.verdict === 'auto-add-canonical' && f.pageUrl === seedUrl,
      )
      const openActionable = after.filter(
        (f) =>
          f.bucket === 'actionable' &&
          (f.status === 'open' || f.status === 'regressed'),
      )

      const report = {
        pass1: {
          status: run1!.status,
          finishedAt: run1!.finishedAt,
          isPartial: run1!.isPartial,
          urlsFound: r1.urlsFound,
          urlsCrawled: r1.urlsCrawled,
          urlsClientOnly: r1.urlsClientOnly,
          counts: r1.counts,
        },
        seedUrl,
        pass2: {
          status: run2!.status,
          finishedAt: run2!.finishedAt,
          isPartial: run2!.isPartial,
          urlsCrawled: r2.urlsCrawled,
          counts: r2.counts,
          resolvedCount: resolved.length,
          seedResolved: seedResolved.length,
          openActionable: openActionable.length,
          resolvedSample: resolved.slice(0, 12).map((f) => ({
            verdict: f.verdict,
            pageUrl: f.pageUrl,
            topicId: f.topicId,
            resolvedAt: f.resolvedAt,
          })),
          openSample: openActionable.slice(0, 8).map((f) => ({
            verdict: f.verdict,
            pageUrl: f.pageUrl,
            topicId: f.topicId,
          })),
        },
      }

      writeFileSync(
        resolve(process.cwd(), 'AUTODUN_TWO_PASS_CRAWL_REPORT.json'),
        JSON.stringify(report, null, 2),
      )
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2))

      expect(seedResolved.length).toBe(1)
      expect(seedResolved[0]!.resolvedAt).not.toBeNull()
    },
    600_000,
  )
})
