import {
  approvalStatusFrom,
  partitionLinkMapApprovals,
  sortLinkMapApprovals,
  toLinkMapApproval,
  type ApprovalFindingInput,
  type ApprovalFlowInput,
  type LinkMapApproval,
} from './approvals'
import type { CustomerPrState } from './customer-pr'
import {
  isObsoleteEvidence,
  markObsoleteFinding,
  obsoleteReasonForRelatedFinding,
} from './obsolete-related'

export type EvaluatedApprovalRow = {
  finding: ApprovalFindingInput
  flow: ApprovalFlowInput
}

export type EvaluatedApprovals = {
  items: LinkMapApproval[]
  history: LinkMapApproval[]
  obsoleteWrites: Array<{
    findingId: string
    evidenceValues: Record<string, unknown>
  }>
}

export function evaluateLinkMapApprovals(input: {
  rows: EvaluatedApprovalRow[]
  inContentInlinkKeys?: Set<string>
  customerPrByUrl?: Map<string, CustomerPrState>
}): EvaluatedApprovals {
  const obsoleteWrites: EvaluatedApprovals['obsoleteWrites'] = []
  const kept: LinkMapApproval[] = []

  for (const { finding, flow } of input.rows) {
    if (isObsoleteEvidence(finding.evidenceValues)) continue
    const prUrl = flow?.prUrl || null
    const pr = prUrl ? input.customerPrByUrl?.get(prUrl) : undefined
    const flowForStatus: ApprovalFlowInput =
      pr?.merged && flow
        ? {
            ...flow,
            mergedAt: pr.mergedAt || flow.mergedAt || new Date().toISOString(),
          }
        : flow
    const status = approvalStatusFrom({ finding, flow: flowForStatus })
    const reason = obsoleteReasonForRelatedFinding(finding, {
      status,
      hasCustomerPr: Boolean(prUrl),
      customerPr: pr ?? null,
      inContentInlinkKeys: input.inContentInlinkKeys,
    })
    if (reason) {
      obsoleteWrites.push({
        findingId: finding.id,
        evidenceValues: markObsoleteFinding(finding.evidenceValues, reason),
      })
      continue
    }
    if (status === 'rejected') continue
    kept.push(toLinkMapApproval(finding, flowForStatus))
  }

  return {
    ...partitionLinkMapApprovals(sortLinkMapApprovals(kept)),
    obsoleteWrites,
  }
}
