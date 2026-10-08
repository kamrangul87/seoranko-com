/**
 * Build a Fix Mission from the latest crawl's actionable findings.
 * Classification only — never starts a fix, branch, or PR.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { classifyFinding } from './classify-finding'
import type {
  ClassifiableFinding,
  ClassifySiteContext,
  FixMissionCounts,
  FixMissionEligibility,
  FixMissionItemRow,
  FixMissionRow,
  SiteConnectorKind,
} from './types'

export type CreateMissionInput = {
  userId: string
  siteId: string
  siteDomain: string
}

function mapConnector(cmsType: string | null | undefined): SiteConnectorKind {
  const t = (cmsType || '').toLowerCase()
  if (t === 'github') return 'github'
  if (t === 'wordpress') return 'wordpress'
  if (t === 'shopify') return 'shopify'
  if (t === 'webflow') return 'webflow'
  if (t === 'universal' || t === 'universal_tag') return 'universal'
  return null
}

/**
 * Connector kind only — never decrypts credentials (mission path must not
 * touch customer secrets or repos).
 */
async function resolveSiteContext(
  userId: string,
  siteId: string,
): Promise<ClassifySiteContext> {
  const supabase = createServiceRoleClient()
  const { data: conn } = await supabase
    .from('site_connections')
    .select('cms_type, is_active')
    .eq('site_id', siteId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!conn) return { connector: null, connected: false }
  const connector = mapConnector(conn.cms_type as string | null)
  return {
    connector,
    connected: connector != null,
  }
}

type FindingDbRow = {
  id: string
  topic_id: string
  verdict: string
  bucket: string
  surface_class: string | null
  affected_url_count: number | null
  declaration_site: string | null
  source_path: string | null
  page_url: string | null
  detail: string | null
  last_seen_run_id: string | null
  first_seen_run_id: string | null
}

function toClassifiable(row: FindingDbRow): ClassifiableFinding {
  return {
    id: row.id,
    topicId: row.topic_id,
    verdict: row.verdict,
    bucket: row.bucket,
    surfaceClass: row.surface_class,
    affectedUrlCount: row.affected_url_count ?? 1,
    declarationSite: row.declaration_site,
    sourcePath: row.source_path,
    pageUrl: row.page_url,
    detail: row.detail,
  }
}

const ELIG_RANK: Record<FixMissionEligibility, number> = {
  safe: 0,
  review: 1,
  blocked: 2,
}

/**
 * Latest crawl for a connected site (any status — matches pre-check "latest").
 */
export async function latestCrawlRunIdForSite(
  siteId: string,
): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('fix_strategies_crawl_runs')
    .select('id')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ? String(data.id) : null
}

export async function loadActionableFindingsForCrawl(
  siteId: string,
  crawlRunId: string | null,
): Promise<FindingDbRow[]> {
  const supabase = createServiceRoleClient()
  let q = supabase
    .from('fix_strategies_findings')
    .select(
      'id, topic_id, verdict, bucket, surface_class, affected_url_count, declaration_site, source_path, page_url, detail, last_seen_run_id, first_seen_run_id',
    )
    .eq('site_id', siteId)
    .eq('bucket', 'actionable')

  if (crawlRunId) {
    q = q.or(
      `last_seen_run_id.eq.${crawlRunId},first_seen_run_id.eq.${crawlRunId}`,
    )
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []) as FindingDbRow[]
}

export function planMissionItems(
  findings: ClassifiableFinding[],
  site: ClassifySiteContext,
): {
  items: Array<{
    findingId: string
    findingCode: string
    strategyId: string | null
    eligibility: FixMissionEligibility
    blockReason: string
    orderIndex: number
    affectedUrlCount: number
  }>
  counts: FixMissionCounts
} {
  const classified = findings.map((f) => {
    const c = classifyFinding(f, site)
    return {
      findingId: f.id,
      findingCode: c.findingCode,
      strategyId: c.strategyId,
      eligibility: c.eligibility,
      blockReason: c.reason,
      affectedUrlCount: f.affectedUrlCount,
      pageUrl: f.pageUrl,
      verdict: f.verdict,
      detail: f.detail,
    }
  })

  classified.sort((a, b) => {
    const er = ELIG_RANK[a.eligibility] - ELIG_RANK[b.eligibility]
    if (er !== 0) return er
    return b.affectedUrlCount - a.affectedUrlCount
  })

  const items = classified.map((c, orderIndex) => ({
    findingId: c.findingId,
    findingCode: c.findingCode,
    strategyId: c.strategyId,
    eligibility: c.eligibility,
    blockReason: c.blockReason,
    orderIndex,
    affectedUrlCount: c.affectedUrlCount,
  }))

  const counts: FixMissionCounts = {
    totalActionable: items.length,
    safe: items.filter((i) => i.eligibility === 'safe').length,
    review: items.filter((i) => i.eligibility === 'review').length,
    blocked: items.filter((i) => i.eligibility === 'blocked').length,
  }

  return { items, counts }
}

function mapMission(
  row: Record<string, unknown>,
  items: FixMissionItemRow[],
): FixMissionRow {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    userId: String(row.user_id),
    crawlRunId: (row.crawl_run_id as string | null) ?? null,
    status: row.status as FixMissionRow['status'],
    counts: {
      totalActionable: Number(row.total_actionable) || 0,
      safe: Number(row.safe_count) || 0,
      review: Number(row.review_count) || 0,
      blocked: Number(row.blocked_count) || 0,
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items,
  }
}

export async function createFixMission(
  input: CreateMissionInput,
): Promise<FixMissionRow> {
  const crawlRunId = await latestCrawlRunIdForSite(input.siteId)
  const rows = await loadActionableFindingsForCrawl(input.siteId, crawlRunId)
  const site = await resolveSiteContext(input.userId, input.siteId)
  const { items: planned, counts } = planMissionItems(
    rows.map(toClassifiable),
    site,
  )

  const supabase = createServiceRoleClient()
  const { data: missionRow, error: missionErr } = await supabase
    .from('fix_missions')
    .insert({
      site_id: input.siteId,
      user_id: input.userId,
      crawl_run_id: crawlRunId,
      status: 'planned',
      total_actionable: counts.totalActionable,
      safe_count: counts.safe,
      review_count: counts.review,
      blocked_count: counts.blocked,
    })
    .select('*')
    .single()

  if (missionErr || !missionRow) {
    throw new Error(missionErr?.message || 'Failed to create fix mission')
  }

  if (planned.length > 0) {
    const { error: itemErr } = await supabase.from('fix_mission_items').insert(
      planned.map((p) => ({
        mission_id: missionRow.id,
        finding_id: p.findingId,
        finding_code: p.findingCode,
        strategy_id: p.strategyId,
        eligibility: p.eligibility,
        block_reason: p.blockReason,
        status: 'pending',
        order_index: p.orderIndex,
      })),
    )
    if (itemErr) throw new Error(itemErr.message)
  }

  return getFixMission(String(missionRow.id), input.userId)
}

export async function getFixMission(
  missionId: string,
  userId: string,
): Promise<FixMissionRow> {
  const supabase = createServiceRoleClient()
  const { data: missionRow, error } = await supabase
    .from('fix_missions')
    .select('*')
    .eq('id', missionId)
    .eq('user_id', userId)
    .single()
  if (error || !missionRow) throw new Error(error?.message || 'Mission not found')

  const { data: itemRows } = await supabase
    .from('fix_mission_items')
    .select('*')
    .eq('mission_id', missionId)
    .order('order_index', { ascending: true })

  const findingIds = (itemRows || []).map((i) => String(i.finding_id))
  const findingMap = new Map<string, FindingDbRow>()
  if (findingIds.length > 0) {
    const { data: findings } = await supabase
      .from('fix_strategies_findings')
      .select(
        'id, topic_id, verdict, bucket, surface_class, affected_url_count, declaration_site, source_path, page_url, detail, last_seen_run_id, first_seen_run_id',
      )
      .in('id', findingIds)
    for (const f of findings || []) {
      findingMap.set(String(f.id), f as FindingDbRow)
    }
  }

  const items: FixMissionItemRow[] = (itemRows || []).map((i) => {
    const f = findingMap.get(String(i.finding_id))
    return {
      id: String(i.id),
      missionId: String(i.mission_id),
      findingId: String(i.finding_id),
      findingCode: String(i.finding_code),
      strategyId: (i.strategy_id as string | null) ?? null,
      eligibility: i.eligibility as FixMissionEligibility,
      blockReason: String(i.block_reason),
      status: 'pending',
      orderIndex: Number(i.order_index) || 0,
      createdAt: String(i.created_at),
      updatedAt: String(i.updated_at),
      pageUrl: f?.page_url ?? null,
      verdict: f?.verdict ?? null,
      detail: f?.detail ?? null,
      affectedUrlCount: f?.affected_url_count ?? null,
    }
  })

  return mapMission(missionRow as Record<string, unknown>, items)
}

export async function getLatestFixMissionForSite(
  siteId: string,
  userId: string,
): Promise<FixMissionRow | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('fix_missions')
    .select('id')
    .eq('site_id', siteId)
    .eq('user_id', userId)
    .eq('status', 'planned')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.id) return null
  return getFixMission(String(data.id), userId)
}
