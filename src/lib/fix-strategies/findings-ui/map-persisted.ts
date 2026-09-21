import type { PersistedEvidenceRow, PersistedFindingRow } from './crawl/constants'
import { dossierSlugForTopic } from './topic-registry'
import type {
  InternalEvidenceItem,
  ProposedDiff,
  SourceCitation,
  UiFinding,
} from './types'
import type { FindingBucket, FindingSurfaceClass } from './types'

function normalizeProposedDiff(
  raw: Record<string, unknown> | null,
): ProposedDiff | null {
  if (!raw) return null
  if (typeof raw.summary === 'string') {
    return {
      summary: raw.summary,
      before: (raw.before as string | null | undefined) ?? null,
      after: (raw.after as string | null | undefined) ?? null,
      targetPath: (raw.targetPath as string | null | undefined) ?? null,
    }
  }
  if (raw.proposed != null) {
    return {
      summary: 'Proposed edit',
      after:
        typeof raw.proposed === 'string'
          ? raw.proposed
          : JSON.stringify(raw.proposed, null, 2),
    }
  }
  return {
    summary: 'Proposed change',
    after: JSON.stringify(raw, null, 2),
  }
}

export function persistedToUiFinding(
  row: PersistedFindingRow,
  evidence: PersistedEvidenceRow[] = [],
): UiFinding {
  return {
    id: row.id,
    topicId: row.topicId,
    kind: row.kind,
    verdict: row.verdict,
    severity: row.severity,
    detail: row.detail,
    pageUrl: row.pageUrl,
    declarationSite: row.declarationSite,
    affectedUrlCount: row.affectedUrlCount,
    rolledUp: row.affectedUrlCount > 1 && Boolean(row.declarationSite),
    bucket: row.bucket as FindingBucket,
    surfaceClass: row.surfaceClass as FindingSurfaceClass,
    autoFixable: row.autoFixable,
    reportOnly: row.reportOnly,
    proposedDiff: normalizeProposedDiff(row.proposedDiff),
    evidenceValues:
      (row.evidenceValues as UiFinding['evidenceValues']) ?? null,
    sources: (row.sourceRows as SourceCitation[]) ?? [],
    internalEvidence: evidence.map(
      (e): InternalEvidenceItem => ({
        verdict: e.verdict,
        detail: e.detail,
        pageUrl: e.pageUrl,
      }),
    ),
    dossierSlug: dossierSlugForTopic(row.topicId),
  }
}
