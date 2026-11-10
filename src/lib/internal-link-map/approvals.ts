import { RELATED_TRANSFORM_VERSION } from '@/lib/fix-strategies/related-articles/anchors'
import {
  RELATED_LINK_TOPIC,
  RELATED_LINK_VERDICT,
} from './queue-related-findings'

export type LinkMapApprovalStatus =
  | 'pending'
  | 'approved'
  | 'pr_opened'
  | 'merged'
  | 'rejected'

export type LinkMapApprovalTarget = {
  href: string
  anchorText: string
}

export type LinkMapApproval = {
  id: string
  pageUrl: string | null
  detail: string
  status: LinkMapApprovalStatus
  prUrl: string | null
  prNumber: number | null
  targets: LinkMapApprovalTarget[]
  neverAutoMerge: true
  canRegenerate: boolean
}

export type ApprovalFindingInput = {
  id: string
  pageUrl: string | null
  detail: string
  status: string
  fixedAt: string | null
  evidenceValues: Record<string, unknown> | null
  proposedDiff: Record<string, unknown> | null
}

export type ApprovalFlowInput = {
  step: string
  approvedAt?: string | null
  prUrl?: string | null
  prNumber?: number | null
  mergedAt?: string | null
} | null

export function isRelatedReadingFinding(row: {
  topicId: string
  verdict: string
}): boolean {
  return row.topicId === RELATED_LINK_TOPIC && row.verdict === RELATED_LINK_VERDICT
}

export function approvalStatusFrom(input: {
  finding: {
    status: string
    fixedAt: string | null
    evidenceValues: Record<string, unknown> | null
  }
  flow: ApprovalFlowInput
}): LinkMapApprovalStatus {
  const ev = input.finding.evidenceValues || {}
  if (ev.rejected === true || typeof ev.rejectedAt === 'string') return 'rejected'
  if (input.finding.fixedAt || input.flow?.mergedAt) return 'merged'
  if (input.finding.status === 'resolved') return 'merged'
  if (
    input.flow?.prUrl ||
    input.flow?.step === 'committed' ||
    input.flow?.step === 'verified'
  ) {
    return 'pr_opened'
  }
  if (input.flow?.step === 'approved' || input.flow?.approvedAt) return 'approved'
  return 'pending'
}

function targetsFrom(finding: ApprovalFindingInput): LinkMapApprovalTarget[] {
  const ev = finding.evidenceValues || {}
  const fromEv = ev.relatedTargets
  const proposed = finding.proposedDiff?.proposed as
    | { relatedTargets?: unknown }
    | undefined
  const raw = Array.isArray(fromEv)
    ? fromEv
    : Array.isArray(proposed?.relatedTargets)
      ? proposed.relatedTargets
      : []
  const out: LinkMapApprovalTarget[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const rec = t as { href?: unknown; anchorText?: unknown }
    if (typeof rec.href === 'string' && typeof rec.anchorText === 'string') {
      out.push({ href: rec.href, anchorText: rec.anchorText })
    }
  }
  return out
}

export function canRegenerateRelated(
  finding: ApprovalFindingInput,
  flow: ApprovalFlowInput,
): boolean {
  const status = approvalStatusFrom({ finding, flow })
  if (status !== 'pr_opened') return false
  return finding.evidenceValues?.relatedTransformVersion !== RELATED_TRANSFORM_VERSION
}

export function toLinkMapApproval(
  finding: ApprovalFindingInput,
  flow: ApprovalFlowInput,
): LinkMapApproval {
  const status = approvalStatusFrom({ finding, flow })
  return {
    id: finding.id,
    pageUrl: finding.pageUrl,
    detail: finding.detail,
    status,
    prUrl: flow?.prUrl ?? null,
    prNumber: flow?.prNumber ?? null,
    targets: targetsFrom(finding),
    neverAutoMerge: true,
    canRegenerate: canRegenerateRelated(finding, flow),
  }
}
