/**
 * Persist internal link edges for a findings crawl run.
 * Memory store in tests / when SERVICE_ROLE is absent; Supabase otherwise.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { chunkArray } from '@/lib/fix-strategies/findings-ui/crawl/batch-insert'
import { extractCrawlLinkEdges } from './extract-edges'
import type { SlimCrawlJob } from './load-map'
import type { CrawlLinkEdge } from './types'

export type PersistCrawlLinkEdgesInput = {
  runId: string
  siteId: string | null
  userId: string
  edges: CrawlLinkEdge[]
}

type StoredEdge = CrawlLinkEdge & {
  runId: string
  siteId: string | null
  userId: string
}

const g = globalThis as unknown as { __crawlLinkEdges?: StoredEdge[] }
let preferMemory = false

function mem(): StoredEdge[] {
  if (!g.__crawlLinkEdges) g.__crawlLinkEdges = []
  return g.__crawlLinkEdges
}

export function resetMemoryCrawlLinkEdges(): void {
  g.__crawlLinkEdges = []
}

export function useMemoryCrawlLinkEdges(): void {
  preferMemory = true
}

function edgeKey(runId: string, e: CrawlLinkEdge): string {
  return `${runId}\0${e.sourceUrl}\0${e.targetUrl}\0${e.hrefRaw}`
}

function canUseSupabase(): boolean {
  if (preferMemory) return false
  if (process.env.VITEST) return false
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  )
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n)
}

export async function appendCrawlLinkEdges(
  input: PersistCrawlLinkEdgesInput,
): Promise<void> {
  if (input.edges.length === 0) return
  if (!canUseSupabase()) {
    const seen = new Set(mem().filter((e) => e.runId === input.runId).map((e) => edgeKey(e.runId, e)))
    for (const e of input.edges) {
      const k = edgeKey(input.runId, e)
      if (seen.has(k)) continue
      seen.add(k)
      mem().push({
        ...e,
        hrefRaw: clip(e.hrefRaw, 1000),
        anchorText: clip(e.anchorText, 500),
        runId: input.runId,
        siteId: input.siteId,
        userId: input.userId,
      })
    }
    return
  }

  const db = createServiceRoleClient()
  const rows = input.edges.map((e) => ({
    run_id: input.runId,
    site_id: input.siteId,
    user_id: input.userId,
    source_url: e.sourceUrl,
    target_url: e.targetUrl,
    href_raw: clip(e.hrefRaw, 1000),
    anchor_text: clip(e.anchorText, 500),
    is_nofollow: e.isNofollow,
    target_http_status: e.targetHttpStatus,
    target_final_url: e.targetFinalUrl,
    is_redirect: e.isRedirect,
  }))
  for (const chunk of chunkArray(rows, 200)) {
    const { error } = await db.from('fix_strategies_crawl_link_edges').upsert(chunk, {
      onConflict: 'run_id,source_url,target_url,href_raw',
      ignoreDuplicates: true,
    })
    if (error) {
      console.warn('[internal-link-map] edge insert', error.message)
    }
  }
}

/** Extract + persist internal edges from one crawled page. Never throws. */
export async function persistEdgesFromHtml(input: {
  runId: string
  siteId: string | null
  userId: string
  html: string
  pageUrl: string
  origin: string
}): Promise<number> {
  try {
    const edges = extractCrawlLinkEdges(input.html, input.pageUrl, input.origin)
    if (edges.length === 0) return 0
    await appendCrawlLinkEdges({
      runId: input.runId,
      siteId: input.siteId,
      userId: input.userId,
      edges,
    })
    return edges.length
  } catch (err) {
    console.warn(
      '[internal-link-map] persist page edges failed',
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}

export async function listCrawlLinkEdges(runId: string): Promise<CrawlLinkEdge[]> {
  if (!canUseSupabase()) {
    return mem()
      .filter((e) => e.runId === runId)
      .map(
        ({
          sourceUrl,
          targetUrl,
          hrefRaw,
          anchorText,
          isNofollow,
          targetHttpStatus,
          targetFinalUrl,
          isRedirect,
        }) => ({
          sourceUrl,
          targetUrl,
          hrefRaw,
          anchorText,
          isNofollow,
          targetHttpStatus,
          targetFinalUrl,
          isRedirect,
        }),
      )
  }

  const db = createServiceRoleClient()
  const out: CrawlLinkEdge[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('fix_strategies_crawl_link_edges')
      .select(
        'source_url, target_url, href_raw, anchor_text, is_nofollow, target_http_status, target_final_url, is_redirect',
      )
      .eq('run_id', runId)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const chunk = data ?? []
    for (const row of chunk) {
      out.push({
        sourceUrl: String(row.source_url),
        targetUrl: String(row.target_url),
        hrefRaw: String(row.href_raw),
        anchorText: String(row.anchor_text ?? ''),
        isNofollow: Boolean(row.is_nofollow),
        targetHttpStatus: (row.target_http_status as number | null) ?? null,
        targetFinalUrl: (row.target_final_url as string | null) ?? null,
        isRedirect: Boolean(row.is_redirect),
      })
    }
    if (chunk.length < pageSize) break
  }
  return out
}

/** Job statuses without body_html — Hobby-safe for ~2000 URLs. */
export async function listSlimCrawlJobs(runId: string): Promise<SlimCrawlJob[]> {
  if (!canUseSupabase()) return []
  const db = createServiceRoleClient()
  const out: SlimCrawlJob[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('fix_strategies_crawl_url_jobs')
      .select('url, status, http_status, final_url')
      .eq('run_id', runId)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const chunk = data ?? []
    for (const row of chunk) {
      out.push({
        url: String(row.url),
        status: String(row.status),
        httpStatus: (row.http_status as number | null) ?? null,
        finalUrl: (row.final_url as string | null) ?? null,
      })
    }
    if (chunk.length < pageSize) break
  }
  return out
}
