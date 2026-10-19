/**
 * LIVE: re-upsert findings from the latest autodun crawl emits (after
 * listRunEmits pagination fix) without re-crawling.
 */
import { describe, expect, it } from 'vitest'
import { getFindingsStore } from './index'
import { rollupAndClassify } from './run-detectors'

const live =
  process.env.LIVE_CRAWL === '1' &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)

const SITE_ID = '50b305a3-baab-49ce-8966-04796b8b27c4'

describe.skipIf(!live)('re-upsert autodun latest run emits', () => {
  it(
    'persists topic 43 contact orphan after paginated listRunEmits',
    async () => {
      const store = getFindingsStore()
      const runs = await store.listRunsForSite(SITE_ID)
      const run = runs[0]
      expect(run?.id).toBeTruthy()
      const emits = await store.listRunEmits(run!.id)
      expect(emits.length).toBeGreaterThan(1000)
      const has43 = emits.some(
        (e) =>
          e.topicId === '43' &&
          e.verdict === 'auto-add-nav-link' &&
          /contact/i.test(e.pageUrl || ''),
      )
      expect(has43).toBe(true)

      const { findings, internalEvidence } = rollupAndClassify(emits)
      const rolled43 = findings.find(
        (f) => f.topicId === '43' && f.verdict === 'auto-add-nav-link',
      )
      expect(rolled43).toBeTruthy()

      await store.clearRunEvidence(run!.id)
      await store.upsertFindings({
        siteId: SITE_ID,
        detectOrigin: run!.detectOrigin,
        userId: run!.userId,
        runId: run!.id,
        findings,
        internalEvidence,
      })

      const listed = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: true,
      })
      const contact = listed.find(
        (f) =>
          f.topicId === '43' &&
          (f.status === 'open' || f.status === 'regressed') &&
          /contact/i.test(f.pageUrl || ''),
      )
      expect(contact).toBeTruthy()
      const privacy = listed.find(
        (f) =>
          f.topicId === '14' &&
          f.verdict === 'auto-self-canonical' &&
          /privacy/i.test(f.pageUrl || ''),
      )
      expect(privacy).toBeTruthy()
      const counts = await store.counts({ siteId: SITE_ID })
      // eslint-disable-next-line no-console
      console.log(
        '[reupsert]',
        JSON.stringify({
          emitCount: emits.length,
          counts,
          actionable: listed
            .filter(
              (f) =>
                (f.status === 'open' || f.status === 'regressed') &&
                f.bucket === 'actionable',
            )
            .map((f) => ({
              topicId: f.topicId,
              verdict: f.verdict,
              pageUrl: f.pageUrl,
              autoFixable: f.autoFixable,
              surfaceClass: f.surfaceClass,
            })),
        }),
      )
    },
    120_000,
  )
})
