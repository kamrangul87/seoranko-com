/**
 * Fix Receipt — view over fix_strategies_run_items + runs + findings.
 * No new source of truth beyond the optional share_token column.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { ownerPlainEnglish } from './owner-copy'

export type FixReceipt = {
  itemId: string
  runId: string
  siteId: string
  pageUrl: string | null
  topicId: string
  verdict: string
  plainEnglish: string
  path: string | null
  commitSha: string | null
  prUrl: string | null
  prNumber: number | null
  mergeSha: string | null
  previewVerifiedAt: string | null
  productionVerifiedAt: string | null
  status: string
  shareToken: string | null
  /** Public path when shareToken is set. */
  sharePath: string | null
  createdAt: string
}

type ItemJoinRow = {
  id: string
  run_id: string
  finding_id: string
  status: string
  path: string | null
  commit_sha: string | null
  preview_verified_at: string | null
  production_verified_at: string | null
  share_token: string | null
  created_at: string
  fix_strategies_runs: {
    id: string
    user_id: string
    site_id: string
    pr_url: string | null
    pr_number: number | null
    merge_sha: string | null
  } | null
  fix_strategies_findings: {
    id: string
    page_url: string | null
    topic_id: string
    verdict: string
  } | null
}

function rowToReceipt(row: ItemJoinRow): FixReceipt | null {
  const run = row.fix_strategies_runs
  const finding = row.fix_strategies_findings
  if (!run || !finding) return null
  const token = row.share_token
  return {
    itemId: row.id,
    runId: row.run_id,
    siteId: run.site_id,
    pageUrl: finding.page_url,
    topicId: String(finding.topic_id),
    verdict: finding.verdict,
    plainEnglish:
      ownerPlainEnglish(finding.verdict) ??
      `Fixed: ${finding.verdict.replace(/_/g, ' ')}`,
    path: row.path,
    commitSha: row.commit_sha,
    prUrl: run.pr_url,
    prNumber: run.pr_number,
    mergeSha: run.merge_sha,
    previewVerifiedAt: row.preview_verified_at,
    productionVerifiedAt: row.production_verified_at,
    status: row.status,
    shareToken: token,
    sharePath: token ? `/receipt/${token}` : null,
    createdAt: row.created_at,
  }
}

const ITEM_SELECT = `
  id, run_id, finding_id, status, path, commit_sha,
  preview_verified_at, production_verified_at, share_token, created_at,
  fix_strategies_runs!inner ( id, user_id, site_id, pr_url, pr_number, merge_sha ),
  fix_strategies_findings!inner ( id, page_url, topic_id, verdict )
`

/** Owner-scoped list of verified-live items for a site (Fix Receipts index). */
export async function listFixReceiptsForSite(input: {
  userId: string
  siteId: string
  limit?: number
}): Promise<FixReceipt[]> {
  const sb = createServiceRoleClient()
  const { data, error } = await sb
    .from('fix_strategies_run_items')
    .select(ITEM_SELECT)
    .eq('status', 'verified_live')
    .eq('fix_strategies_runs.site_id', input.siteId)
    .eq('fix_strategies_runs.user_id', input.userId)
    .order('production_verified_at', { ascending: false, nullsFirst: false })
    .limit(input.limit ?? 50)
  if (error) throw new Error(error.message)
  return ((data || []) as unknown as ItemJoinRow[])
    .map(rowToReceipt)
    .filter((r): r is FixReceipt => r != null)
}

export async function getFixReceiptForOwner(input: {
  userId: string
  itemId: string
}): Promise<FixReceipt | null> {
  const sb = createServiceRoleClient()
  const { data, error } = await sb
    .from('fix_strategies_run_items')
    .select(ITEM_SELECT)
    .eq('id', input.itemId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as unknown as ItemJoinRow
  if (row.fix_strategies_runs?.user_id !== input.userId) return null
  return rowToReceipt(row)
}

/** Public share — only when share_token is set. */
export async function getFixReceiptByShareToken(
  token: string,
): Promise<FixReceipt | null> {
  if (!token || token.length < 8) return null
  const sb = createServiceRoleClient()
  const { data, error } = await sb
    .from('fix_strategies_run_items')
    .select(ITEM_SELECT)
    .eq('share_token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return rowToReceipt(data as unknown as ItemJoinRow)
}

export async function setFixReceiptShareToken(input: {
  userId: string
  itemId: string
  token: string | null
}): Promise<FixReceipt | null> {
  const existing = await getFixReceiptForOwner({
    userId: input.userId,
    itemId: input.itemId,
  })
  if (!existing) return null
  if (existing.status !== 'verified_live') {
    throw new Error('Only verified-live fixes can be shared')
  }
  const sb = createServiceRoleClient()
  const { error } = await sb
    .from('fix_strategies_run_items')
    .update({
      share_token: input.token,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.itemId)
  if (error) throw new Error(error.message)
  return getFixReceiptForOwner({
    userId: input.userId,
    itemId: input.itemId,
  })
}
