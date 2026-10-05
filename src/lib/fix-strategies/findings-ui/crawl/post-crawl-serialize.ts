/**
 * Serialize / deserialize SitemapInspection for crawl-run persistence.
 * Sets are not JSON-safe — store as string arrays.
 */

import type {
  SitemapInspection,
  SitemapDocument,
  SitemapDeclaration,
} from '@/lib/fix-strategies/shared/sitemap-inspect'
import type { RobotsTxtInspection } from '@/lib/fix-strategies/shared/robots-txt-inspect'
import type { InternalLinkGraph } from '@/lib/fix-strategies/shared/internal-link-graph'

export type SerializedSitemapInspection = {
  originUrl: string
  robots: RobotsTxtInspection
  declarations: SitemapDeclaration[]
  documents: SitemapDocument[]
  allLocsNormalized: string[]
  allLocsRaw: string[]
  discoveredUnreferenced: string[]
}

export function serializeSitemapInspection(
  inspection: SitemapInspection,
): SerializedSitemapInspection {
  return {
    originUrl: inspection.originUrl,
    robots: inspection.robots,
    declarations: inspection.declarations,
    documents: inspection.documents,
    allLocsNormalized: Array.from(inspection.allLocsNormalized),
    allLocsRaw: inspection.allLocsRaw,
    discoveredUnreferenced: inspection.discoveredUnreferenced,
  }
}

export function deserializeSitemapInspection(
  raw: unknown,
): SitemapInspection | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<SerializedSitemapInspection>
  if (typeof r.originUrl !== 'string' || !r.robots || !Array.isArray(r.documents)) {
    return null
  }
  return {
    originUrl: r.originUrl,
    robots: r.robots,
    declarations: Array.isArray(r.declarations) ? r.declarations : [],
    documents: r.documents,
    allLocsNormalized: new Set(
      Array.isArray(r.allLocsNormalized) ? r.allLocsNormalized : [],
    ),
    allLocsRaw: Array.isArray(r.allLocsRaw) ? r.allLocsRaw : [],
    discoveredUnreferenced: Array.isArray(r.discoveredUnreferenced)
      ? r.discoveredUnreferenced
      : [],
  }
}

export function serializeLinkGraph(graph: InternalLinkGraph): InternalLinkGraph {
  // Already plain JSON (no Sets/Maps).
  return graph
}

export function deserializeLinkGraph(raw: unknown): InternalLinkGraph | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Partial<InternalLinkGraph>
  if (
    typeof g.originUrl !== 'string' ||
    typeof g.homepageNormalized !== 'string' ||
    !Array.isArray(g.nodes) ||
    !Array.isArray(g.edges)
  ) {
    return null
  }
  return g as InternalLinkGraph
}
