/**
 * Persist fix_strategies_runs + run_items (memory for tests, Supabase for prod).
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type {
  FixRun,
  FixRunItem,
  FixRunItemStatus,
  FixRunPhase,
  FixRunStatus,
  FixRunSummary,
} from './types'
import { computeSummary } from './phases'

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return crypto.randomUUID()
}

/** Higher = further along; used so stale ticks cannot regress progress. */
const ITEM_STATUS_RANK: Record<FixRunItemStatus, number> = {
  pending: 0,
  applying: 1,
  committed: 2,
  preview_verified: 3,
  production_verified: 4,
  verified_live: 5,
  noop: 6,
  failed: 6,
}

const PHASE_RANK: Record<FixRunPhase, number> = {
  create_branch: 0,
  apply_next: 1,
  ensure_pr: 2,
  wait_preview: 3,
  verify_preview_next: 4,
  await_approval: 5,
  merge: 6,
  verify_production_next: 7,
  recrawl: 8,
  done: 9,
}

export function pickForwardItemStatus(
  dbStatus: FixRunItemStatus | null | undefined,
  incoming: FixRunItemStatus,
): FixRunItemStatus {
  if (!dbStatus) return incoming
  // Allow explicit failure / noop transitions from any non-terminal verify state.
  if (incoming === 'failed' || incoming === 'noop') return incoming
  if (dbStatus === 'failed' || dbStatus === 'noop') return dbStatus
  return ITEM_STATUS_RANK[incoming] >= ITEM_STATUS_RANK[dbStatus]
    ? incoming
    : dbStatus
}

export function mergeRunForSave(
  incoming: FixRun,
  fresh: Record<string, unknown> | null,
): FixRun {
  if (!fresh) return incoming
  const dbPhase = fresh.phase as FixRunPhase | undefined
  const dbPreview = (fresh.preview_url as string | null) ?? null
  const dbStatus = fresh.status as FixRunStatus | undefined

  let phase = incoming.phase
  if (
    dbPhase &&
    PHASE_RANK[dbPhase] > PHASE_RANK[incoming.phase] &&
    // Allow intentional terminal failure from any phase.
    incoming.status !== 'failed'
  ) {
    phase = dbPhase
  }

  const dbCursor = Number(fresh.item_cursor ?? 0)
  const itemCursor = Math.max(incoming.itemCursor, dbCursor)

  // Keep a real preview URL if a stale wait_preview tick tries to clear it.
  const previewUrl =
    incoming.previewUrl ||
    (dbPreview && !/^https?:\/\/(preview\.)?example\.com/i.test(dbPreview)
      ? dbPreview
      : null) ||
    null

  const status =
    incoming.status === 'failed'
      ? 'failed'
      : dbStatus === 'complete' || dbStatus === 'failed'
        ? dbStatus
        : incoming.status

  return {
    ...incoming,
    phase,
    previewUrl: previewUrl ?? incoming.previewUrl,
    status,
    itemCursor,
  }
}

export type FixRunStore = {
  createRun(input: {
    userId: string
    siteId: string
    findingIds: string[]
    branchName: string
  }): Promise<FixRun>
  getRun(runId: string, userId: string): Promise<FixRun | null>
  saveRun(run: FixRun): Promise<FixRun>
  listActiveForSite(siteId: string, userId: string): Promise<FixRun | null>
}

// ── Memory ──────────────────────────────────────────────────────────

const memoryRuns = new Map<string, FixRun>()

export function resetMemoryFixRunStore() {
  memoryRuns.clear()
  useMemory = true
}

let useMemory = false

export function useMemoryFixRunStore() {
  useMemory = true
}

export function createMemoryFixRunStore(): FixRunStore {
  return {
    async createRun({ userId, siteId, findingIds, branchName }) {
      const id = newId()
      const now = nowIso()
      const items: FixRunItem[] = findingIds.map((findingId, position) => ({
        id: newId(),
        runId: id,
        findingId,
        position,
        status: 'pending',
        commitSha: null,
        path: null,
        previewVerifiedAt: null,
        productionVerifiedAt: null,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      }))
      const run: FixRun = {
        id,
        userId,
        siteId,
        status: 'queued',
        phase: 'create_branch',
        branchName,
        prNumber: null,
        prUrl: null,
        previewUrl: null,
        mergeSha: null,
        approvedAt: null,
        autoMergeAttempted: false,
        autoMergeBlockedReason: null,
        itemCursor: 0,
        errorDetail: null,
        summary: computeSummary(items),
        prevContents: {},
        createdAt: now,
        updatedAt: now,
        items,
      }
      memoryRuns.set(id, run)
      return structuredClone(run)
    },

    async getRun(runId, userId) {
      const r = memoryRuns.get(runId)
      if (!r || r.userId !== userId) return null
      return structuredClone(r)
    },

    async saveRun(run) {
      const next = {
        ...run,
        summary: computeSummary(run.items),
        prevContents: run.prevContents || {},
        updatedAt: nowIso(),
      }
      memoryRuns.set(run.id, next)
      return structuredClone(next)
    },

    async listActiveForSite(siteId, userId) {
      for (const r of memoryRuns.values()) {
        if (
          r.siteId === siteId &&
          r.userId === userId &&
          r.status !== 'complete' &&
          r.status !== 'failed'
        ) {
          return structuredClone(r)
        }
      }
      return null
    },
  }
}

// ── Supabase ────────────────────────────────────────────────────────

function rowToItem(row: Record<string, unknown>): FixRunItem {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    findingId: String(row.finding_id),
    position: Number(row.position ?? 0),
    status: row.status as FixRunItemStatus,
    commitSha: (row.commit_sha as string | null) ?? null,
    path: (row.path as string | null) ?? null,
    previewVerifiedAt: (row.preview_verified_at as string | null) ?? null,
    productionVerifiedAt: (row.production_verified_at as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToRun(
  row: Record<string, unknown>,
  items: FixRunItem[],
): FixRun {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    siteId: String(row.site_id),
    status: row.status as FixRunStatus,
    phase: row.phase as FixRunPhase,
    branchName: (row.branch_name as string | null) ?? null,
    prNumber: row.pr_number == null ? null : Number(row.pr_number),
    prUrl: (row.pr_url as string | null) ?? null,
    previewUrl: (row.preview_url as string | null) ?? null,
    mergeSha: (row.merge_sha as string | null) ?? null,
    approvedAt: (row.approved_at as string | null) ?? null,
    autoMergeAttempted: Boolean(row.auto_merge_attempted),
    autoMergeBlockedReason:
      (row.auto_merge_blocked_reason as string | null) ?? null,
    itemCursor: Number(row.item_cursor ?? 0),
    errorDetail: (row.error_detail as string | null) ?? null,
    summary: (row.summary as FixRunSummary | null) ?? computeSummary(items),
    prevContents:
      ((row.summary as { _prevContents?: Record<string, string> } | null)
        ?._prevContents as Record<string, string> | undefined) || {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items,
  }
}

export function createSupabaseFixRunStore(): FixRunStore {
  return {
    async createRun({ userId, siteId, findingIds, branchName }) {
      const supabase = createServiceRoleClient()
      const { data: runRow, error } = await supabase
        .from('fix_strategies_runs')
        .insert({
          user_id: userId,
          site_id: siteId,
          status: 'queued',
          phase: 'create_branch',
          branch_name: branchName,
        })
        .select('*')
        .single()
      if (error || !runRow) {
        throw new Error(error?.message || 'Failed to create fix run')
      }
      const itemRows = findingIds.map((findingId, position) => ({
        run_id: runRow.id,
        finding_id: findingId,
        position,
        status: 'pending',
      }))
      const { data: items, error: itemErr } = await supabase
        .from('fix_strategies_run_items')
        .insert(itemRows)
        .select('*')
      if (itemErr) {
        throw new Error(itemErr.message)
      }
      return rowToRun(
        runRow as Record<string, unknown>,
        (items || []).map((r) => rowToItem(r as Record<string, unknown>)),
      )
    },

    async getRun(runId, userId) {
      const supabase = createServiceRoleClient()
      const { data: runRow, error } = await supabase
        .from('fix_strategies_runs')
        .select('*')
        .eq('id', runId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error || !runRow) return null
      const { data: items } = await supabase
        .from('fix_strategies_run_items')
        .select('*')
        .eq('run_id', runId)
        .order('position', { ascending: true })
      return rowToRun(
        runRow as Record<string, unknown>,
        (items || []).map((r) => rowToItem(r as Record<string, unknown>)),
      )
    },

    async saveRun(run) {
      const supabase = createServiceRoleClient()

      // Reload DB row so a stale in-memory tick cannot regress phase/items
      // (classic race: wait_preview pending save clobbering preview_verified).
      const { data: freshRow } = await supabase
        .from('fix_strategies_runs')
        .select('phase, preview_url, status, item_cursor')
        .eq('id', run.id)
        .eq('user_id', run.userId)
        .maybeSingle()
      const merged = mergeRunForSave(run, freshRow as Record<string, unknown> | null)

      const summary = {
        ...computeSummary(merged.items),
        _prevContents: merged.prevContents || {},
      }
      const { error } = await supabase
        .from('fix_strategies_runs')
        .update({
          status: merged.status,
          phase: merged.phase,
          branch_name: merged.branchName,
          pr_number: merged.prNumber,
          pr_url: merged.prUrl,
          preview_url: merged.previewUrl,
          merge_sha: merged.mergeSha,
          approved_at: merged.approvedAt,
          auto_merge_attempted: merged.autoMergeAttempted,
          auto_merge_blocked_reason: merged.autoMergeBlockedReason,
          item_cursor: merged.itemCursor,
          error_detail: merged.errorDetail,
          summary,
          updated_at: nowIso(),
        })
        .eq('id', merged.id)
        .eq('user_id', merged.userId)
      if (error) throw new Error(error.message)

      const { data: dbItems } = await supabase
        .from('fix_strategies_run_items')
        .select('id, status, commit_sha, path, preview_verified_at, production_verified_at, failure_reason')
        .eq('run_id', merged.id)

      const dbById = new Map(
        (dbItems || []).map((r) => [String((r as { id: string }).id), r as Record<string, unknown>]),
      )

      for (const item of merged.items) {
        const prev = dbById.get(item.id)
        const nextStatus = pickForwardItemStatus(
          (prev?.status as FixRunItemStatus | undefined) ?? null,
          item.status,
        )
        const nextPreviewAt =
          item.previewVerifiedAt ||
          (prev?.preview_verified_at as string | null) ||
          null
        const nextProdAt =
          item.productionVerifiedAt ||
          (prev?.production_verified_at as string | null) ||
          null
        const { error: ie } = await supabase
          .from('fix_strategies_run_items')
          .update({
            status: nextStatus,
            commit_sha: item.commitSha ?? (prev?.commit_sha as string | null) ?? null,
            path: item.path ?? (prev?.path as string | null) ?? null,
            preview_verified_at: nextPreviewAt,
            production_verified_at: nextProdAt,
            failure_reason:
              nextStatus === 'failed'
                ? item.failureReason
                : nextStatus === (prev?.status as string)
                  ? ((prev?.failure_reason as string | null) ?? item.failureReason)
                  : item.failureReason,
            updated_at: nowIso(),
          })
          .eq('id', item.id)
        if (ie) throw new Error(ie.message)
        item.status = nextStatus
        item.previewVerifiedAt = nextPreviewAt
        item.productionVerifiedAt = nextProdAt
      }
      return {
        ...merged,
        summary: computeSummary(merged.items),
        updatedAt: nowIso(),
      }
    },

    async listActiveForSite(siteId, userId) {
      const supabase = createServiceRoleClient()
      const { data: runRow } = await supabase
        .from('fix_strategies_runs')
        .select('*')
        .eq('site_id', siteId)
        .eq('user_id', userId)
        .not('status', 'in', '("complete","failed")')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!runRow) return null
      return this.getRun(String(runRow.id), userId)
    },
  }
}

export function getFixRunStore(): FixRunStore {
  if (useMemory) return createMemoryFixRunStore()
  return createSupabaseFixRunStore()
}
