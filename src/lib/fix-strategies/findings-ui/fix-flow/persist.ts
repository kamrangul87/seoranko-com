/**
 * Findings fix-flow persistence — Supabase when SERVICE_ROLE is set,
 * otherwise in-memory (tests). Never stub-passes commit/verify.
 */

import { randomUUID } from 'node:crypto'
import type { FixFlowState } from '../types'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export type FixFlowRecord = FixFlowState & {
  userId: string
  errorDetail: string | null
  updatedAt: string
}

type MemState = Map<string, FixFlowRecord>

const g = globalThis as unknown as { __fsFixFlows?: MemState }

function mem(): MemState {
  if (!g.__fsFixFlows) g.__fsFixFlows = new Map()
  return g.__fsFixFlows
}

function idle(findingId: string, userId: string): FixFlowRecord {
  return {
    findingId,
    userId,
    step: 'idle',
    approvedAt: null,
    committedAt: null,
    commitStub: false,
    commitDetail: null,
    commitSha: null,
    branchName: null,
    prUrl: null,
    prNumber: null,
    previewUrl: null,
    verifiedAt: null,
    verifyOk: null,
    verifyDetail: null,
    autoMerged: null,
    mergedAt: null,
    mergeSha: null,
    productionVerifyOk: null,
    productionVerifyDetail: null,
    revertPrUrl: null,
    revertPrNumber: null,
    needsHumanAttention: false,
    flagDetail: null,
    autoMergeBlockedReason: null,
    errorDetail: null,
    updatedAt: new Date().toISOString(),
  }
}

function mapRow(row: Record<string, unknown>): FixFlowRecord {
  return {
    findingId: String(row.finding_id),
    userId: String(row.user_id),
    step: row.step as FixFlowRecord['step'],
    approvedAt: (row.approved_at as string | null) ?? null,
    committedAt: (row.committed_at as string | null) ?? null,
    commitStub: Boolean(row.commit_stub),
    commitDetail: (row.commit_detail as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    branchName: (row.branch_name as string | null) ?? null,
    prUrl: (row.pr_url as string | null) ?? null,
    prNumber:
      row.pr_number == null ? null : Number(row.pr_number),
    previewUrl: (row.preview_url as string | null) ?? null,
    verifiedAt: (row.verified_at as string | null) ?? null,
    verifyOk:
      row.verify_ok == null ? null : Boolean(row.verify_ok),
    verifyDetail: (row.verify_detail as string | null) ?? null,
    autoMerged:
      row.auto_merged == null ? null : Boolean(row.auto_merged),
    mergedAt: (row.merged_at as string | null) ?? null,
    mergeSha: (row.merge_sha as string | null) ?? null,
    productionVerifyOk:
      row.production_verify_ok == null
        ? null
        : Boolean(row.production_verify_ok),
    productionVerifyDetail:
      (row.production_verify_detail as string | null) ?? null,
    revertPrUrl: (row.revert_pr_url as string | null) ?? null,
    revertPrNumber:
      row.revert_pr_number == null
        ? null
        : Number(row.revert_pr_number),
    needsHumanAttention: Boolean(row.needs_human_attention),
    flagDetail: (row.flag_detail as string | null) ?? null,
    autoMergeBlockedReason:
      (row.auto_merge_blocked_reason as string | null) ?? null,
    errorDetail: (row.error_detail as string | null) ?? null,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  }
}

function toUi(r: FixFlowRecord): FixFlowState {
  return {
    findingId: r.findingId,
    step: r.step,
    approvedAt: r.approvedAt,
    committedAt: r.committedAt,
    commitStub: r.commitStub,
    commitDetail: r.commitDetail,
    commitSha: r.commitSha,
    branchName: r.branchName,
    prUrl: r.prUrl,
    prNumber: r.prNumber,
    previewUrl: r.previewUrl,
    verifiedAt: r.verifiedAt,
    verifyOk: r.verifyOk,
    verifyDetail: r.verifyDetail,
    autoMerged: r.autoMerged,
    mergedAt: r.mergedAt,
    mergeSha: r.mergeSha,
    productionVerifyOk: r.productionVerifyOk,
    productionVerifyDetail: r.productionVerifyDetail,
    revertPrUrl: r.revertPrUrl,
    revertPrNumber: r.revertPrNumber,
    needsHumanAttention: r.needsHumanAttention ?? false,
    flagDetail: r.flagDetail,
    autoMergeBlockedReason: r.autoMergeBlockedReason,
  }
}

function supabaseAvailable(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  )
}

export type FixFlowStore = {
  get(findingId: string, userId: string): Promise<FixFlowState>
  save(record: FixFlowRecord): Promise<FixFlowState>
}

export function createMemoryFixFlowStore(): FixFlowStore {
  return {
    async get(findingId, userId) {
      const existing = mem().get(findingId)
      if (existing && existing.userId === userId) return toUi(existing)
      const fresh = idle(findingId, userId)
      mem().set(findingId, fresh)
      return toUi(fresh)
    },
    async save(record) {
      const next = { ...record, updatedAt: new Date().toISOString() }
      mem().set(record.findingId, next)
      return toUi(next)
    },
  }
}

export function createSupabaseFixFlowStore(): FixFlowStore {
  const db = () => createServiceRoleClient()
  return {
    async get(findingId, userId) {
      const { data, error } = await db()
        .from('fix_strategies_fix_flows')
        .select('*')
        .eq('finding_id', findingId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (data) return toUi(mapRow(data as Record<string, unknown>))
      const fresh = idle(findingId, userId)
      const { error: insErr } = await db()
        .from('fix_strategies_fix_flows')
        .upsert({
          finding_id: findingId,
          user_id: userId,
          step: 'idle',
          commit_stub: false,
          updated_at: fresh.updatedAt,
        })
      if (insErr) throw new Error(insErr.message)
      return toUi(fresh)
    },
    async save(record) {
      const row = {
        finding_id: record.findingId,
        user_id: record.userId,
        step: record.step,
        approved_at: record.approvedAt,
        committed_at: record.committedAt,
        verified_at: record.verifiedAt,
        commit_stub: record.commitStub,
        commit_detail: record.commitDetail,
        commit_sha: record.commitSha,
        branch_name: record.branchName,
        pr_url: record.prUrl,
        pr_number: record.prNumber,
        preview_url: record.previewUrl,
        verify_ok: record.verifyOk,
        verify_detail: record.verifyDetail,
        auto_merged: record.autoMerged,
        merged_at: record.mergedAt,
        merge_sha: record.mergeSha,
        production_verify_ok: record.productionVerifyOk,
        production_verify_detail: record.productionVerifyDetail,
        revert_pr_url: record.revertPrUrl,
        revert_pr_number: record.revertPrNumber,
        needs_human_attention: record.needsHumanAttention ?? false,
        flag_detail: record.flagDetail,
        auto_merge_blocked_reason: record.autoMergeBlockedReason,
        error_detail: record.errorDetail,
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await db()
        .from('fix_strategies_fix_flows')
        .upsert(row)
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return toUi(mapRow(data as Record<string, unknown>))
    },
  }
}

let active: FixFlowStore | null = null
let preferMemory = false

export function getFixFlowStore(): FixFlowStore {
  if (active) return active
  if (!preferMemory && supabaseAvailable()) {
    active = createSupabaseFixFlowStore()
    return active
  }
  active = createMemoryFixFlowStore()
  return active
}

export function useMemoryFixFlowStore(): FixFlowStore {
  preferMemory = true
  mem().clear()
  active = createMemoryFixFlowStore()
  return active
}

export function resetMemoryFixFlowStore(): void {
  mem().clear()
  active = null
  preferMemory = false
}

/** @internal test helper */
export function _testIdle(findingId = randomUUID(), userId = 'u'): FixFlowRecord {
  return idle(findingId, userId)
}

export { toUi, idle as _idleForTests }
