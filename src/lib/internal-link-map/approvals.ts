import {
  RELATED_TRANSFORM_VERSION,
  decodeHtmlEntities,
} from '@/lib/fix-strategies/related-articles/anchors'
import {
  RELATED_LINK_TOPIC,
  RELATED_LINK_VERDICT,
} from './queue-related-findings'
import {
  relatedVerifyFromUnknown,
  summarizeRelatedVerify,
} from './verify-related-live'

export type LinkMapApprovalStatus =
  | 'pending'
  | 'approved'
  | 'pr_opened'
  | 'merged'
  | 'rejected'

export type LinkMapApprovalTarget = {
  href: string
  anchorText: string
  score?: number
  reason?: string
  weakMatch?: boolean
}

export type LinkMapApproval = {
  id: string
  pageUrl: string | null
  detail: string
  status: LinkMapApprovalStatus
  prUrl: string | null
  prNumber: number | null
  targets: LinkMapApprovalTarget[]
  score: number | null
  reason: string | null
  weakMatch: boolean
  verifyBadge: 'verified' | 'problem' | null
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

export function isLinkHealthFinding(row: {
  topicId: string
  verdict: string
  evidenceValues?: Record<string, unknown> | null
}): boolean {
  const kind = row.evidenceValues?.linkHealthKind
  return typeof kind === 'string' && kind.length > 0
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
  if (ev.obsolete === true || ev.dismissed === true) return 'rejected'
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
    const rec = t as {
      href?: unknown
      anchorText?: unknown
      score?: unknown
      reason?: unknown
      weakMatch?: unknown
    }
    if (typeof rec.href === 'string' && typeof rec.anchorText === 'string') {
      const item: LinkMapApprovalTarget = {
        href: rec.href,
        anchorText: decodeHtmlEntities(rec.anchorText),
      }
      if (typeof rec.score === 'number') item.score = rec.score
      if (typeof rec.reason === 'string') item.reason = decodeHtmlEntities(rec.reason)
      if (rec.weakMatch === true) item.weakMatch = true
      out.push(item)
    }
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.href.localeCompare(b.href))
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
  const targets = targetsFrom(finding)
  const top = targets[0]
  const ev = finding.evidenceValues || {}
  const verify = relatedVerifyFromUnknown(ev.relatedVerify)
  const healthHint =
    typeof ev.linkHealthHint === 'string' ? decodeHtmlEntities(ev.linkHealthHint) : null
  return {
    id: finding.id,
    pageUrl: finding.pageUrl,
    detail: finding.detail,
    status,
    prUrl: flow?.prUrl ?? null,
    prNumber: flow?.prNumber ?? null,
    targets,
    score: typeof top?.score === 'number' ? top.score : null,
    reason: top?.reason ?? healthHint,
    weakMatch: targets.some((t) => t.weakMatch),
    verifyBadge: status === 'merged' ? summarizeRelatedVerify(verify) : null,
    neverAutoMerge: true,
    canRegenerate: canRegenerateRelated(finding, flow),
  }
}

export function sortLinkMapApprovals(items: LinkMapApproval[]): LinkMapApproval[] {
  return [...items].sort((a, b) => {
    const sa = a.score ?? -1
    const sb = b.score ?? -1
    if (sb !== sa) return sb - sa
    return (a.pageUrl || a.id).localeCompare(b.pageUrl || b.id)
  })
}
