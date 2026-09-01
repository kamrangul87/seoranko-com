/**
 * Convert Index Diagnosis crawl findings into Fix Agent PageAuditIssue entries.
 * Mechanical fixes are auto-classified; missing destination pages stay human tasks.
 */

import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import type { PageAuditIssue, PageAuditFixMetadata } from '@/lib/page-audit-engine'
import type { SitemapDriftReport } from '@/lib/sitemap-generator/drift'

export const CRAWLER_JS_LIMITATION =
  'This crawler uses HTTP fetch only — it does not execute JavaScript. Links added by client-side JS (SPAs, React nav menus) may appear as "not linked internally" even when visible in a browser. Verify manually before treating as a real gap.'

function meta(partial: PageAuditFixMetadata): PageAuditFixMetadata {
  return partial
}

export function buildIndexDiagnosisFixAgentIssues(
  result: IndexDiagnosisResult,
  drift: SitemapDriftReport | null,
): PageAuditIssue[] {
  const issues: PageAuditIssue[] = []
  const inbound = result.inboundLinksByUrl || {}

  for (const p of result.pages) {
    const canonStep = p.steps.find((s) => s.step === 'canonical')
    if (!canonStep || canonStep.passed) continue
    if (!/\/index\.html?$/i.test(p.url)) continue
    if (!canonStep.evidence.includes('different same-host URL')) continue

    const target = canonStep.evidence.match(/Canonical points to different same-host URL: ([^\s]+)/)?.[1]
    if (!target) continue

    issues.push({
      id: `idx-canonical-${encodeURIComponent(p.url)}`,
      severity: 'warning',
      category: 'index-diagnosis',
      title: 'index.html canonical points elsewhere — redirect needed',
      description: canonStep.evidence,
      remediation: `Fix Agent can add a 301 redirect from ${p.url} to ${target} in next.config.js (GitHub-connected sites).`,
      fixMetadata: meta({
        kind: 'redirect-canonical',
        fromUrl: p.url,
        toUrl: target,
        evidence: canonStep.evidence,
      }),
    })
  }

  const non200 = result.coverage.excluded.filter((e) => e.reason === 'NON_200')
  for (const dead of non200) {
    const sources = (inbound[dead.url] || []).map((l) => l.fromUrl)
    if (sources.length > 0) {
      issues.push({
        id: `idx-dead-link-remove-${encodeURIComponent(dead.url)}`,
        severity: 'warning',
        category: 'index-diagnosis',
        title: `Remove dead internal link to ${dead.url.replace(/^https?:\/\/[^/]+/, '') || dead.url}`,
        description: `${dead.evidence}. Linked from ${sources.length} crawled page(s).`,
        remediation: 'Auto-fixable: Fix Agent can remove the dead <a href> from source page(s). Does not recreate the missing destination page.',
        fixMetadata: meta({
          kind: 'remove-dead-link',
          deadUrl: dead.url,
          sourceUrls: sources,
          evidence: dead.evidence,
        }),
      })
    }

    issues.push({
      id: `idx-dead-page-${encodeURIComponent(dead.url)}`,
      severity: 'warning',
      category: 'index-diagnosis',
      title: `Destination page missing: ${dead.url.replace(/^https?:\/\/[^/]+/, '') || dead.url}`,
      description: `${dead.evidence}. The URL returns a non-200 status.`,
      remediation:
        'Human task: the destination page needs real content (e.g. a privacy policy). SEORANKO cannot invent legal or business copy — restore the page or redirect to a live URL manually.',
      fixMetadata: meta({
        kind: 'missing-page-content',
        deadUrl: dead.url,
        evidence: dead.evidence,
      }),
    })
  }

  if (drift?.hasDrift) {
    const parts: string[] = []
    if (drift.missingFromLive.length > 0) parts.push(`${drift.missingFromLive.length} indexable page(s) missing from live sitemap`)
    if (drift.deadInLive.length > 0) parts.push(`${drift.deadInLive.length} dead/stale URL(s) still listed`)
    if (drift.liveHealthFailures.length > 0) {
      parts.push(`${drift.liveHealthFailures.length} live sitemap URL(s) not returning HTTP 200`)
    }
    if (drift.noindexContradictions.length > 0) {
      parts.push(`${drift.noindexContradictions.length} noindex page(s) still listed in sitemap`)
    }
    if (!drift.liveSitemapFetched && drift.expectedIndexableCount > 0) parts.push('no live sitemap found')

    issues.push({
      id: 'idx-sitemap-drift',
      severity: 'warning',
      category: 'index-diagnosis',
      title: `Sitemap out of date: ${parts.join('; ')}`,
      description: `Live sitemap (${drift.liveSitemapEvidence}) does not match the current crawl. Expected ${drift.expectedIndexableCount} indexable URL(s).${
        drift.liveHealthFailures.length > 0
          ? ` ${drift.liveHealthFailures.length} deployed URL(s) failed live HTTP check.`
          : ''
      }${
        drift.noindexContradictions.length > 0
          ? ` ${drift.noindexContradictions.length} URL(s) have noindex contradictions — remove from sitemap or remove noindex on the page.`
          : ''
      }`,
      remediation: drift.generatedSitemapXml
        ? 'Auto-fixable on GitHub-connected sites: Regenerate & apply commits an updated sitemap.xml. Until replaced, this finding will reappear on every audit.'
        : 'Generate an updated sitemap from the Sitemap tool and upload it to your site root.',
      fixMetadata: meta({
        kind: 'sitemap-regenerate',
        sitemapContent: drift.generatedSitemapXml || undefined,
        sitemapPath: drift.generatedSitemapPath,
        evidence: parts.join('; '),
      }),
    })
  }

  return issues
}
