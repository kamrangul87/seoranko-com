import type { PersistedEvidenceRow, PersistedFindingRow } from './crawl/constants'
import { dossierSlugForTopic } from './topic-registry'
import {
  ownerPlainEnglish,
  primarySourceIdForTopic,
  sourceTierForTopic,
  whyFindingNotAutoFixed,
  whyNotFixedOrFallback,
} from './owner-copy'
import { sourceById, sourcesForTopic } from './sources'
import type {
  InternalEvidenceItem,
  LeftAloneItem,
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

function mapInternalEvidence(
  evidence: PersistedEvidenceRow[],
): InternalEvidenceItem[] {
  return evidence.map(
    (e): InternalEvidenceItem => ({
      verdict: e.verdict,
      detail: e.detail,
      pageUrl: e.pageUrl,
      whyNotFixed: whyNotFixedOrFallback(e.verdict),
    }),
  )
}

export function persistedToUiFinding(
  row: PersistedFindingRow,
  evidence: PersistedEvidenceRow[] = [],
): UiFinding {
  const surfaceClass = row.surfaceClass as FindingSurfaceClass
  const dossierSlug = dossierSlugForTopic(row.topicId)
  const primarySourceId = primarySourceIdForTopic(row.topicId)
  const stored = (row.sourceRows as SourceCitation[]) ?? []
  const sources =
    stored.length > 0
      ? (() => {
          const primary = sourceById(primarySourceId)
          if (!primary) return stored
          if (stored.some((s) => s.sourceId === primary.sourceId)) return stored
          return [primary, ...stored]
        })()
      : sourcesForTopic(row.topicId, dossierSlug, primarySourceId)

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
    surfaceClass,
    autoFixable: row.autoFixable,
    reportOnly: row.reportOnly,
    proposedDiff: normalizeProposedDiff(row.proposedDiff),
    evidenceValues:
      (row.evidenceValues as UiFinding['evidenceValues']) ?? null,
    sources,
    internalEvidence: mapInternalEvidence(evidence),
    dossierSlug,
    ownerPlainEnglish: ownerPlainEnglish(row.verdict),
    sourceTier: sourceTierForTopic(row.topicId),
    primarySourceId,
    whyNotAutoFixed: whyFindingNotAutoFixed({
      autoFixable: row.autoFixable,
      reportOnly: row.reportOnly,
      surfaceClass,
    }),
  }
}

/** Roll up internal evidence across findings for the left-alone view. */
export function aggregateLeftAlone(findings: UiFinding[]): LeftAloneItem[] {
  const byVerdict = new Map<
    string,
    { whyNotFixed: string; count: number; topicIds: Set<string> }
  >()
  for (const f of findings) {
    for (const e of f.internalEvidence) {
      const why = e.whyNotFixed ?? whyNotFixedOrFallback(e.verdict)
      const cur = byVerdict.get(e.verdict)
      if (cur) {
        cur.count += 1
        cur.topicIds.add(f.topicId)
      } else {
        byVerdict.set(e.verdict, {
          whyNotFixed: why,
          count: 1,
          topicIds: new Set([f.topicId]),
        })
      }
    }
  }
  return Array.from(byVerdict.entries())
    .map(([verdict, v]) => ({
      verdict,
      whyNotFixed: v.whyNotFixed,
      count: v.count,
      topicIds: Array.from(v.topicIds).sort(),
    }))
    .sort((a, b) => b.count - a.count || a.verdict.localeCompare(b.verdict))
}
