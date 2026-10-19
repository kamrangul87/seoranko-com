/**
 * LIVE: recrawl autodun site 50b305a3… with hosted Supabase FindingsStore.
 * Run: LIVE_CRAWL=1 npx vitest run src/lib/fix-strategies/findings-ui/crawl/autodun-parity-recrawl.live.test.ts
 */
import { describe, expect, it } from 'vitest'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { startCrawlRun } from './orchestrator'
import { getFindingsStore } from './index'
import { drainCrawlRunToTerminal } from './scheduled-recrawl'

const live =
  process.env.LIVE_CRAWL === '1' &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)

const SITE_ID = '50b305a3-baab-49ce-8966-04796b8b27c4'
const ORIGIN = 'https://autodun.com'

describe.skipIf(!live)('autodun Diagnostics↔Audit parity recrawl', () => {
  it(
    'crawls autodun and surfaces topic 14 / privacy + approval fixes',
    async () => {
      const sb = createSupabaseJsClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      const { data: site, error } = await sb
        .from('connected_sites')
        .select('id, user_id, domain')
        .eq('id', SITE_ID)
        .maybeSingle()
      expect(error).toBeNull()
      expect(site?.user_id).toBeTruthy()

      const store = getFindingsStore()
      const { runId } = await startCrawlRun({
        siteId: SITE_ID,
        userId: String(site!.user_id),
        origin: ORIGIN,
        detectOnly: false,
        store,
        maxUrls: 50,
      })
      const drained = await drainCrawlRunToTerminal(runId, store, {
        maxTicks: 100,
      })
      expect(['complete', 'partial']).toContain(drained.status)

      const counts = await store.counts({ siteId: SITE_ID })
      const findings = await store.listFindings({
        siteId: SITE_ID,
        includeInformational: true,
      })
      const open = findings.filter(
        (f) => f.status === 'open' || f.status === 'regressed',
      )
      // eslint-disable-next-line no-console
      console.log(
        '[parity-recrawl]',
        JSON.stringify(
          {
            runId,
            drained,
            counts,
            openSample: open.slice(0, 50).map((f) => ({
              topicId: f.topicId,
              verdict: f.verdict,
              bucket: f.bucket,
              autoFixable: f.autoFixable,
              pageUrl: f.pageUrl,
            })),
          },
          null,
          2,
        ),
      )

      const privacy = open.find(
        (f) =>
          f.topicId === '14' &&
          f.verdict === 'auto-self-canonical' &&
          /privacy/i.test(f.pageUrl || ''),
      )
      expect(privacy).toBeTruthy()
    },
    10 * 60_000,
  )
})
