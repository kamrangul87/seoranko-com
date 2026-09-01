import type {
  CrawlCoverage,
  IndexDiagnosisCause,
  IndexDiagnosisVerdict,
  PageIndexability,
} from './types'

interface CauseBucket {
  cause: string
  urls: PageIndexability[]
}

function groupBlockedCauses(pages: PageIndexability[]): CauseBucket[] {
  const buckets = new Map<string, PageIndexability[]>()

  for (const p of pages.filter((x) => x.verdict === 'BLOCKED')) {
    const step = p.decisiveStep || 'http_status'
    const key =
      step === 'robots_txt'
        ? 'Blocked by robots.txt'
        : step === 'meta_robots'
          ? 'Blocked by meta robots noindex'
          : step === 'x_robots'
            ? 'Blocked by X-Robots-Tag noindex'
            : step === 'http_status'
              ? 'Non-200 HTTP status'
              : `Blocked at ${step}`
    const list = buckets.get(key) || []
    list.push(p)
    buckets.set(key, list)
  }

  return Array.from(buckets.entries()).map(([cause, urls]) => ({ cause, urls }))
}

function groupAtRiskCauses(pages: PageIndexability[]): CauseBucket[] {
  const buckets = new Map<string, PageIndexability[]>()

  for (const p of pages.filter((x) => x.verdict === 'AT_RISK')) {
    let key = 'At risk (unspecified)'
    if (p.duplicateClusterSize >= 3) {
      key = `Near-duplicate cluster (${p.duplicateClusterSize} pages)`
    } else if (p.decisiveStep === 'canonical') {
      key = 'Canonical misconfiguration'
    } else if (p.decisiveStep === 'internal_links_in') {
      key = 'Orphan / low internal links'
    } else if (p.decisiveStep === 'crawl_depth') {
      key = 'Deep crawl depth with weak internal linking'
    }
    const list = buckets.get(key) || []
    list.push(p)
    buckets.set(key, list)
  }

  return Array.from(buckets.entries()).map(([cause, urls]) => ({ cause, urls }))
}

export function buildIndexDiagnosisVerdict(
  coverage: CrawlCoverage,
  pages: PageIndexability[],
): IndexDiagnosisVerdict {
  const indexableCount = pages.filter((p) => p.verdict === 'INDEXABLE').length
  const blockedCount = pages.filter((p) => p.verdict === 'BLOCKED').length
  const atRiskCount = pages.filter((p) => p.verdict === 'AT_RISK').length

  const notIndexable = blockedCount + atRiskCount

  const blockedBuckets = groupBlockedCauses(pages)
  const riskBuckets = groupAtRiskCauses(pages)
  const allBuckets = [...blockedBuckets, ...riskBuckets].sort((a, b) => b.urls.length - a.urls.length)

  const topCauses: IndexDiagnosisCause[] = allBuckets.slice(0, 3).map((b) => {
    const example = b.urls[0]!
    return {
      cause: b.cause,
      affectedUrlCount: b.urls.length,
      exampleUrl: example.url,
      exampleEvidence: example.decisiveEvidence,
    }
  })

  let headline: string
  if (coverage.discoveredCount === 0) {
    headline = 'No URLs discovered for this domain.'
  } else if (notIndexable === 0) {
    headline = `${coverage.discoveredCount.toLocaleString()} pages found, ${coverage.fetchedCount.toLocaleString()} crawled. All ${pages.length} analysed URLs are indexable as configured.`
  } else {
    const largest = allBuckets[0]
    const largestClause = largest
      ? ` The largest cause is ${largest.urls.length} page${largest.urls.length !== 1 ? 's' : ''} ${largest.cause.toLowerCase()}.`
      : ''
    headline = `${coverage.discoveredCount.toLocaleString()} pages found, ${coverage.fetchedCount.toLocaleString()} crawled. ${notIndexable.toLocaleString()} page${notIndexable !== 1 ? 's' : ''} cannot be indexed as configured.${largestClause}`
  }

  return {
    headline,
    topCauses,
    indexableCount,
    blockedCount,
    atRiskCount,
  }
}
