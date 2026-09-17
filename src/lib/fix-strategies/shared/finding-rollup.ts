/**
 * Register-wide generator-level rollup (topic 33 principle).
 *
 * Where N pages share a defect because one shared layout, component, or
 * generator produces it, emit ONE finding naming that declaration site with
 * the affected URL count — not N per-page findings.
 */

import {
  classifyDeclarationSite,
  isCollapsibleDeclarationSite,
  type DeclarationSiteKind,
} from './declaration-site'

export type { DeclarationSiteKind }

export type RollupFindingInput = {
  topicId: string
  verdict: string
  pageUrl: string
  /** Topic 70 / caller-resolved declaration site. */
  declarationSite: string | null
  /** Optional override; otherwise derived from declarationSite path. */
  declarationKind?: DeclarationSiteKind | null
  severity?: string | null
  detail?: string
  /** Opaque passthrough for callers (values, fixTarget, etc.). */
  payload?: Record<string, unknown>
}

export type RolledUpFinding = RollupFindingInput & {
  declarationKind: DeclarationSiteKind
  affectedUrlCount: number
  memberUrls: string[]
  /** True when this row replaces two or more page-level findings. */
  rolledUp: boolean
}

function groupKey(f: RollupFindingInput, kind: DeclarationSiteKind): string {
  if (
    f.declarationSite &&
    isCollapsibleDeclarationSite(kind)
  ) {
    return `${f.topicId}\0${f.declarationSite}\0${f.verdict}`
  }
  // Page-local / unknown — keep distinct per URL
  return `${f.topicId}\0${f.pageUrl}\0${f.verdict}\0${f.declarationSite ?? ''}`
}

/**
 * Collapse findings that share a collapsible declaration site.
 * Non-collapsible rows pass through unchanged (affectedUrlCount = 1).
 */
export function rollupFindingsByDeclarationSite(
  findings: RollupFindingInput[],
): RolledUpFinding[] {
  const groups = new Map<string, RollupFindingInput[]>()

  for (const f of findings) {
    const kind =
      f.declarationKind ?? classifyDeclarationSite(f.declarationSite)
    const key = groupKey({ ...f, declarationKind: kind }, kind)
    const list = groups.get(key) ?? []
    list.push(f)
    groups.set(key, list)
  }

  const out: RolledUpFinding[] = []
  for (const members of Array.from(groups.values())) {
    const first = members[0]!
    const kind =
      first.declarationKind ??
      classifyDeclarationSite(first.declarationSite)
    const urls = Array.from(
      new Set(members.map((m) => m.pageUrl).filter(Boolean)),
    )
    const rolledUp =
      isCollapsibleDeclarationSite(kind) && urls.length > 1

    const detail = rolledUp
      ? `${urls.length} pages inherit ${first.verdict} from ${first.declarationSite}. Report once (topic 33 / register rollup).${first.detail ? ` ${first.detail}` : ''}`
      : first.detail

    out.push({
      ...first,
      declarationKind: kind,
      detail,
      affectedUrlCount: urls.length,
      memberUrls: urls,
      rolledUp,
    })
  }

  return out
}
