/* eslint-disable @typescript-eslint/no-explicit-any */
// Turns a site-audit page's ephemeral AuditIssue[] into stable seo_issue
// rows with a real lifecycle. This does not replace site_audit_results —
// that table stays the per-page latest-state cache the existing UI reads;
// this is the additive Repair Order data source (Phase 0 plan §C decision 3).

import { normalizeUrl } from '@/lib/supabase/audit-db'
import { deriveIssueKey } from './issue-key'
import { classifyActionability, classifyImpact, computeRepairPriority } from './repair-priority'
import { TERMINAL_ISSUE_STATUSES } from './types'

interface IngestIssue {
  severity: 'critical' | 'warning' | 'notice'
  category: string
  message: string
  effort?: '2min' | '30min' | '1hour'
  confidence?: 'high' | 'medium' | 'low'
  auto_fixable?: boolean
}

export interface IngestPage {
  pageUrl: string
  auditRowId?: string | null
  issues: IngestIssue[]
}

export interface IngestResult {
  created: number
  updated: number
  fixed: number
}

/**
 * Upserts seo_issue rows for one audited page and marks previously-open
 * issues FIXED when they're no longer detected. Never reopens a
 * DISMISSED/VERIFIED issue on its own — status: 'FIXED' here means
 * "no longer mechanically detected", not "a repair was verified"; those
 * are deliberately different states (VERIFIED comes only from Repair
 * Verification, PR4). Reopening a FIXED/VERIFIED issue that regresses is
 * PR6's job (regression detection), not this function's.
 */
export async function ingestPageIssues(
  supabase: any,
  params: { userId: string; siteId: string; page: IngestPage }
): Promise<IngestResult> {
  const { userId, siteId, page } = params
  const pageUrl = normalizeUrl(page.pageUrl)
  const result: IngestResult = { created: 0, updated: 0, fixed: 0 }

  const { data: existingRows, error: fetchError } = await supabase
    .from('seo_issue')
    .select('id, issue_key, status')
    .eq('site_id', siteId)
    .eq('page_url', pageUrl)

  if (fetchError) {
    console.error('[seo-workshop] issue fetch failed:', fetchError.message)
    return result
  }

  const existingByKey = new Map<string, { id: string; status: string }>(
    (existingRows ?? []).map((r: any) => [r.issue_key, { id: r.id, status: r.status }])
  )
  const detectedKeys = new Set<string>()

  for (const issue of page.issues) {
    const issueKey = deriveIssueKey(issue)
    detectedKeys.add(issueKey)

    const priorityInput = {
      severity: issue.severity,
      affectedUrlCount: 1,
      confidence: issue.confidence ?? null,
      effort: issue.effort ?? null,
      autoFixable: !!issue.auto_fixable,
    }
    const priorityScore = computeRepairPriority(priorityInput)
    const impact = classifyImpact(priorityInput)
    const actionability = classifyActionability({
      issueKey,
      category: issue.category,
      severity: issue.severity,
      message: issue.message,
    })

    const existing = existingByKey.get(issueKey)

    if (existing && TERMINAL_ISSUE_STATUSES.includes(existing.status as any)) {
      // A resolved/dismissed issue reappearing is a regression signal, not
      // a plain re-detection — leave it for PR6 rather than silently
      // reopening or silently updating a row the user already dismissed.
      continue
    }

    if (existing) {
      const { error } = await supabase
        .from('seo_issue')
        .update({
          category: issue.category,
          severity: issue.severity,
          impact,
          title: issue.message,
          implementation_effort: issue.effort ?? null,
          confidence: issue.confidence ?? null,
          auto_fixable: !!issue.auto_fixable,
          actionability,
          priority_score: priorityScore,
          audit_id: page.auditRowId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) console.error('[seo-workshop] issue update failed:', error.message)
      else result.updated += 1
    } else {
      const { error } = await supabase.from('seo_issue').insert({
        user_id: userId,
        site_id: siteId,
        audit_id: page.auditRowId ?? null,
        issue_key: issueKey,
        category: issue.category,
        severity: issue.severity,
        impact,
        title: issue.message,
        page_url: pageUrl,
        affected_url_count: 1,
        affected_urls: [pageUrl],
        implementation_effort: issue.effort ?? null,
        confidence: issue.confidence ?? null,
        auto_fixable: !!issue.auto_fixable,
        actionability,
        priority_score: priorityScore,
        status: 'NEW',
      })
      if (error) console.error('[seo-workshop] issue insert failed:', error.message)
      else result.created += 1
    }
  }

  const noLongerDetected = (existingRows ?? []).filter(
    (r: any) => !detectedKeys.has(r.issue_key) && !TERMINAL_ISSUE_STATUSES.includes(r.status)
  )
  for (const row of noLongerDetected) {
    const { error } = await supabase
      .from('seo_issue')
      .update({ status: 'FIXED', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) console.error('[seo-workshop] issue auto-resolve failed:', error.message)
    else result.fixed += 1
  }

  return result
}

export async function ingestAuditIssues(
  supabase: any,
  params: { userId: string; siteId: string; pages: IngestPage[] }
): Promise<IngestResult> {
  const total: IngestResult = { created: 0, updated: 0, fixed: 0 }
  for (const page of params.pages) {
    if (page.issues.length === 0 && !page.pageUrl) continue
    const r = await ingestPageIssues(supabase, { userId: params.userId, siteId: params.siteId, page })
    total.created += r.created
    total.updated += r.updated
    total.fixed += r.fixed
  }
  return total
}
