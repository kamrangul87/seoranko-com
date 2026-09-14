import {
  fetchWithEvidence,
  type FetchDeps,
} from '@/lib/fix-strategies/fetch'
import {
  extractAnchors,
  extractInternalFetchableAnchors,
  isInternalHref,
  isSkippableHref,
} from './extract-anchors'

export type GoneAnchorFinding = {
  kind: 'broken-internal-link/410'
  sourceUrl: string
  targetUrl: string
  href: string
}

export type Detect410Result = {
  findings: GoneAnchorFinding[]
  suppressed: Array<{ href: string; reason: string }>
}

/**
 * Topic 1 — 410 branch only.
 * Stable 410 on the target → raise. No further evidence required (topic 68).
 */
export async function detectGoneAnchors(
  sourceHtml: string,
  sourceUrl: string,
  deps: FetchDeps,
): Promise<Detect410Result> {
  const findings: GoneAnchorFinding[] = []
  const suppressed: Detect410Result['suppressed'] = []
  const seen = new Set<string>()

  // Record scheme-filtered / external anchors as suppressed for CI assertions.
  for (const anchor of extractAnchors(sourceHtml)) {
    if (isSkippableHref(anchor.href)) {
      suppressed.push({ href: anchor.href, reason: 'scheme-filter' })
      continue
    }
    if (!isInternalHref(anchor.href, sourceUrl)) {
      suppressed.push({ href: anchor.href, reason: 'external' })
    }
  }

  const candidates = extractInternalFetchableAnchors(sourceHtml, sourceUrl)

  for (const anchor of candidates) {
    const targetUrl = new URL(anchor.href, sourceUrl).toString()
    if (seen.has(targetUrl)) continue
    seen.add(targetUrl)

    const evidence = await fetchWithEvidence(targetUrl, deps)
    if (!evidence.stable) {
      suppressed.push({ href: anchor.href, reason: evidence.reason })
      continue
    }

    const { outcome } = evidence
    if (outcome.kind === 'http' && outcome.status === 410) {
      findings.push({
        kind: 'broken-internal-link/410',
        sourceUrl,
        targetUrl,
        href: anchor.href,
      })
      continue
    }

    if (outcome.kind === 'http' && outcome.status === 200) {
      suppressed.push({ href: anchor.href, reason: 'healthy-200' })
      continue
    }

    suppressed.push({
      href: anchor.href,
      reason:
        outcome.kind === 'http' ? `status-${outcome.status}` : outcome.kind,
    })
  }

  return { findings, suppressed }
}
