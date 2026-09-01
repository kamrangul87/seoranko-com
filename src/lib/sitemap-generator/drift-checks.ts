import type { SitemapCheck } from './types'
import type { SitemapDriftReport } from './drift'

/** Convert live sitemap drift/health findings into sitemap generator checks. */
export function driftReportToSitemapChecks(drift: SitemapDriftReport): SitemapCheck[] {
  const checks: SitemapCheck[] = []

  if (drift.liveHealthChecked) {
    const failures = drift.liveHealthFailures
    if (failures.length === 0 && drift.liveUrlCount > 0) {
      checks.push({
        id: 'live-sitemap-health-ok',
        severity: 'info',
        title: `Live sitemap health: all ${drift.liveUrlCount} URL(s) return HTTP 200`,
        detail: `Fetched the deployed sitemap (${drift.liveSitemapEvidence}) and verified each <loc> URL live on the server.`,
      })
    } else if (failures.length > 0) {
      checks.push({
        id: 'live-sitemap-health-fail',
        severity: 'error',
        title: `${failures.length} live sitemap URL(s) do not return HTTP 200`,
        detail:
          'The deployed sitemap lists URLs that are not live right now (4XX, 5XX, or fetch error). ' +
          'Remove dead URLs, fix server errors, or add redirects and update the sitemap.',
        urls: failures.map((f) =>
          f.error ? `${f.url} — ${f.error}` : `${f.url} — HTTP ${f.httpStatus}`,
        ),
      })
    }
  }

  if (drift.noindexContradictions.length > 0) {
    checks.push({
      id: 'noindex-in-sitemap',
      severity: 'error',
      title: `${drift.noindexContradictions.length} noindex page(s) listed in live sitemap`,
      detail:
        'These URLs appear in the deployed sitemap but the crawl found a noindex directive on the page. ' +
        drift.noindexContradictions[0]!.fixGuidance,
      urls: drift.noindexContradictions.map(
        (c) => `${c.url} (${c.source === 'meta_robots' ? 'meta robots' : 'X-Robots-Tag'}: ${c.evidence})`,
      ),
    })
  } else if (drift.liveSitemapFetched && drift.liveUrlCount > 0) {
    checks.push({
      id: 'noindex-in-sitemap-ok',
      severity: 'info',
      title: 'No noindex contradictions in live sitemap',
      detail:
        'Every live sitemap URL checked against the crawl has no meta/X-Robots noindex conflict (among crawled pages).',
    })
  }

  if (drift.hasDrift) {
    const parts: string[] = []
    if (drift.missingFromLive.length > 0) {
      parts.push(`${drift.missingFromLive.length} indexable page(s) missing from live sitemap`)
    }
    if (drift.deadInLive.length > 0) {
      parts.push(`${drift.deadInLive.length} dead/stale URL(s) still listed`)
    }
    if (!drift.liveSitemapFetched && drift.expectedIndexableCount > 0) {
      parts.push('no live sitemap found')
    }
    if (drift.liveHealthFailures.length > 0) {
      parts.push(`${drift.liveHealthFailures.length} live URL(s) not returning 200`)
    }
    if (drift.noindexContradictions.length > 0) {
      parts.push(`${drift.noindexContradictions.length} noindex contradiction(s)`)
    }

    checks.push({
      id: 'sitemap-drift',
      severity: 'warning',
      title: 'Live sitemap drift detected',
      detail: parts.join('; ') + `. Source: ${drift.liveSitemapEvidence}.`,
      urls: [
        ...drift.missingFromLive.slice(0, 10),
        ...drift.deadInLive.slice(0, 10),
      ].filter(Boolean),
    })
  }

  return checks
}
