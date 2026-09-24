/**
 * Persist page render evidence rows (service-role). Best-effort — no-op when
 * Supabase is unavailable (memory-store tests).
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { CrawledPage } from '@/lib/fix-strategies/findings-ui/crawl/fetch-page'
import type { CrawlUrlJob } from '@/lib/fix-strategies/findings-ui/crawl/constants'

export async function persistPageRenderEvidenceBatch(input: {
  runId: string
  userId: string
  pages: CrawledPage[]
  jobs: CrawlUrlJob[]
}): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return
  }
  const byUrl = new Map(input.jobs.map((j) => [j.url, j]))
  const rows = input.pages
    .filter((p) => p.renderEvidence)
    .map((p) => {
      const job = byUrl.get(p.requestedUrl) || byUrl.get(p.finalUrl)
      const ev = p.renderEvidence!
      return {
        run_id: input.runId,
        job_id: job?.id ?? null,
        user_id: input.userId,
        url: p.finalUrl || p.requestedUrl,
        render_mode: ev.renderMode,
        raw_html_hash: ev.rawHtmlHash,
        rendered_html_hash: ev.renderedHtmlHash,
        render_needed: ev.renderNeeded,
        render_needed_reasons: ev.renderNeededReasons,
        render_error: ev.renderError,
      }
    })
  if (rows.length === 0) return
  const db = createServiceRoleClient()
  const { error } = await db
    .from('fix_strategies_page_render_evidence')
    .upsert(rows, { onConflict: 'run_id,url' })
  if (error) {
    // Table may not exist until migration applies — do not fail the crawl.
    console.warn('[page-render-evidence]', error.message)
  }
}
