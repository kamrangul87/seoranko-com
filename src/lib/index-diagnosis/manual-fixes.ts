/**
 * Deterministic manual-fix payloads from Index Diagnosis crawl evidence.
 */

import { normalizeUrl } from '@/lib/supabase/audit-db'
import {
  buildCanonicalTagSnippetWithPlacement,
  developerRedirectSnippets,
} from '@/lib/developer-snippet-placements'
import type { FetchedPage } from './crawler'
import { buildDuplicateCohortBriefContext } from './cohort-topic'
import type {
  CohortMetrics,
  IndexDiagnosisResult,
  InboundLinkEvidence,
  ManualFixPayload,
  ManualFixRedirectTarget,
  ManualFixSnippet,
  SiteFollowUpTask,
  SiteFollowUpTaskKind,
} from './types'

export { developerRedirectSnippets } from '@/lib/developer-snippet-placements'

function canonicalTagSnippet(pageUrl: string, evidence: string): ManualFixSnippet {
  return buildCanonicalTagSnippetWithPlacement(pageUrl, evidence)
}

export function buildInboundLinkMap(pages: FetchedPage[]): Map<string, InboundLinkEvidence[]> {
  const map = new Map<string, InboundLinkEvidence[]>()
  const hostNorm = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }

  for (const page of pages) {
    const links = Array.from(page.html.matchAll(/href=["']([^"'#?]+)["']/gi))
    for (const m of links) {
      let abs = m[1].trim()
      try {
        if (abs.startsWith('/')) abs = new URL(abs, page.finalUrl).href
        if (!abs.startsWith('http')) continue
        if (hostNorm(abs) !== hostNorm(page.finalUrl)) continue
        const target = normalizeUrl(abs)
        const list = map.get(target) || []
        if (!list.some((x) => x.fromUrl === page.finalUrl)) {
          list.push({ fromUrl: page.finalUrl, fromDepth: page.depth })
        }
        map.set(target, list)
      } catch {
        /* skip */
      }
    }
  }
  return map
}

function taskKindFromId(id: string): SiteFollowUpTaskKind | null {
  if (id.startsWith('canonical-index-html-')) return 'canonical'
  if (id === 'sitemap-missing-linked-urls') return 'sitemap_gap'
  if (id === 'non-200-linked-urls') return 'non_200'
  if (id.startsWith('cohort-dup-')) return 'duplicate_cohort'
  return null
}

function canonicalManualFix(
  task: SiteFollowUpTask,
  pages: IndexDiagnosisResult['pages'],
): ManualFixPayload {
  const pageUrl = task.affectedUrls[0]!
  const page = pages.find((p) => p.url === pageUrl)
  const canonEvidence =
    page?.steps.find((s) => s.step === 'canonical')?.evidence || task.evidence
  const targetMatch = canonEvidence.match(/Canonical points to different same-host URL: ([^\s]+)/)
  const redirectTarget = targetMatch?.[1] || pageUrl.replace(/\/index\.html?$/i, '/')

  return {
    taskId: task.id,
    fixType: 'canonical',
    fixMode: 'hybrid',
    evidenceCitation: `Based on the canonical tag found at ${pageUrl} during this crawl: ${canonEvidence}`,
    contentFixKind: 'canonical_tag',
    canonicalSelfUrl: pageUrl,
    redirectTargets: [
      {
        fromUrl: pageUrl,
        toUrl: redirectTarget,
        evidence: `Canonical misconfiguration at ${pageUrl}`,
      },
    ],
    snippets: [
      canonicalTagSnippet(
        pageUrl,
        `Based on canonical tag found at ${pageUrl} during this crawl (${canonEvidence})`,
      ),
      {
        id: 'canonical-redirect-guidance',
        label: `${pageUrl} — redirect vs canonical options`,
        kind: 'guidance',
        content: `${pageUrl}
Evidence: ${canonEvidence}

Option A (recommended) — 301 redirect: permanently send ${pageUrl} to ${redirectTarget} so search engines only see one URL. Use the platform picker below or the developer snippets.

Option B — self-referencing canonical: change the <link rel="canonical"> to ${pageUrl} itself. Only use this if both URLs must remain live (usually a redirect is cleaner).`,
      },
      ...developerRedirectSnippets(
        pageUrl,
        redirectTarget,
        `Based on canonical misconfiguration at ${pageUrl} during this crawl`,
      ),
    ],
  }
}

function sitemapGapManualFix(task: SiteFollowUpTask, coverage: IndexDiagnosisResult['coverage']): ManualFixPayload {
  const urls = task.affectedUrls.length > 0 ? task.affectedUrls : coverage.linkedOnlyUrls

  return {
    taskId: task.id,
    fixType: 'sitemap_gap',
    fixMode: 'infrastructure',
    evidenceCitation: `Based on ${urls.length} URL(s) linked internally but absent from sitemap.xml during this crawl (${coverage.robotsTxtEvidence})`,
    snippets: [],
    sitemapDomain: coverage.domain,
    linkedOnlyHighlight: urls,
  }
}

function non200ManualFix(
  task: SiteFollowUpTask,
  coverage: IndexDiagnosisResult['coverage'],
  inboundMap: Map<string, InboundLinkEvidence[]>,
): ManualFixPayload {
  const non200 = coverage.excluded.filter((e) => e.reason === 'NON_200')
  const urls = task.affectedUrls.length > 0 ? task.affectedUrls : non200.map((e) => e.url)

  const redirectTargets: ManualFixRedirectTarget[] = []
  const snippets: ManualFixSnippet[] = []

  for (const url of urls) {
    const record = non200.find((e) => e.url === url)
    const status = record?.httpStatus ?? undefined
    const inbound = inboundMap.get(normalizeUrl(url)) || []
    const evidence = record?.evidence || `HTTP ${status ?? 'error'} at ${url}`

    redirectTargets.push({
      fromUrl: url,
      toUrl: '/',
      evidence,
      httpStatus: status,
      inboundFrom: inbound.map((i) => i.fromUrl),
    })

    snippets.push({
      id: `non200-guidance-${url}`,
      label: `${url} — affected pages & options`,
      kind: 'guidance',
      content: `${url} (HTTP ${status ?? 'unknown'})
Evidence: ${evidence}
Linked from ${inbound.length} crawled page(s):${
        inbound.length > 0
          ? `\n${inbound.map((i) => `  • ${i.fromUrl}`).join('\n')}`
          : '\n  (no inbound links captured — may be linked from uncrawled pages)'
      }

Option A — remove the dead link on the source page(s) if this URL should not exist.
Option B — create the page, or add a redirect (pick the correct live destination).`,
    })

    snippets.push(
      ...developerRedirectSnippets(
        url,
        '/',
        `Example redirect for ${url} — replace destination with the correct live URL (${evidence})`,
      ).map((s) => ({
        ...s,
        id: `${s.id}-${url}`,
        label: `${url} — ${s.label}`,
      })),
    )
  }

  return {
    taskId: task.id,
    fixType: 'non_200',
    fixMode: 'infrastructure',
    evidenceCitation: `Based on non-200 responses during this crawl: ${non200.map((e) => e.evidence).join(' | ')}`,
    redirectTargets,
    snippets,
    removeLinkGuidance:
      'If the destination should not exist, remove or update the internal link on each source page listed above.',
  }
}

function duplicateCohortManualFix(
  task: SiteFollowUpTask,
  cohorts: CohortMetrics[],
  pages: IndexDiagnosisResult['pages'],
): ManualFixPayload {
  const cohortId = task.id.replace(/^cohort-dup-/, '')
  const cohort = cohorts.find((c) => c.cohortId === cohortId)
  const briefContext = buildDuplicateCohortBriefContext(
    cohortId,
    cohort?.label || task.title.replace(/^Near-duplicate cohort: /, ''),
    cohort?.flagEvidence || task.evidence,
    pages,
    cohort?.duplicateClusterDensity,
  )

  return {
    taskId: task.id,
    fixType: 'duplicate_cohort',
    fixMode: 'content',
    evidenceCitation: briefContext.flagEvidence,
    snippets: [],
    briefSeedKeyword: briefContext.sharedTopic,
    briefContext,
  }
}

export function generateManualFixForTask(
  task: SiteFollowUpTask,
  result: IndexDiagnosisResult,
  inboundMap: Map<string, InboundLinkEvidence[]>,
): ManualFixPayload | null {
  const kind = task.kind || taskKindFromId(task.id)
  if (!kind) return null

  switch (kind) {
    case 'canonical':
      return task.affectedUrls[0] ? canonicalManualFix(task, result.pages) : null
    case 'sitemap_gap':
      return sitemapGapManualFix(task, result.coverage)
    case 'non_200':
      return non200ManualFix(task, result.coverage, inboundMap)
    case 'duplicate_cohort':
      return duplicateCohortManualFix(task, result.cohorts, result.pages)
    default:
      return null
  }
}

export function buildManualFixesForResult(
  result: IndexDiagnosisResult,
  inboundMap: Map<string, InboundLinkEvidence[]>,
): Record<string, ManualFixPayload> {
  const out: Record<string, ManualFixPayload> = {}
  for (const task of result.followUpTasks) {
    const fix = generateManualFixForTask(task, result, inboundMap)
    if (fix) out[task.id] = fix
  }
  return out
}

export function lookupManualFixForUrl(
  rawUrl: string,
  result: IndexDiagnosisResult,
  inboundMap: Map<string, InboundLinkEvidence[]>,
): ManualFixPayload | null {
  let url: string
  try {
    url = normalizeUrl(rawUrl.startsWith('http') ? rawUrl : `https://${result.coverage.domain}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`)
  } catch {
    return null
  }

  const canonPage = result.pages.find((p) => p.url === url)
  if (canonPage) {
    const canonStep = canonPage.steps.find((s) => s.step === 'canonical')
    if (canonStep && !canonStep.passed && /\/index\.html?$/i.test(url)) {
      const task: SiteFollowUpTask = {
        id: `canonical-index-html-${url}`,
        kind: 'canonical',
        title: 'index.html canonical points elsewhere',
        detail: '',
        evidence: canonStep.evidence,
        affectedUrls: [url],
      }
      return canonicalManualFix(task, result.pages)
    }
  }

  const non200 = result.coverage.excluded.find((e) => e.url === url && e.reason === 'NON_200')
  if (non200) {
    const task: SiteFollowUpTask = {
      id: 'non-200-linked-urls',
      kind: 'non_200',
      title: 'Internally linked URLs return non-200',
      detail: '',
      evidence: non200.evidence,
      affectedUrls: [url],
    }
    return non200ManualFix(task, result.coverage, inboundMap)
  }

  if (result.coverage.linkedOnlyUrls.includes(url)) {
    const task: SiteFollowUpTask = {
      id: 'sitemap-missing-linked-urls',
      kind: 'sitemap_gap',
      title: 'Linked URLs missing from sitemap',
      detail: '',
      evidence: `linkedOnlyUrls includes ${url}`,
      affectedUrls: [url],
    }
    return sitemapGapManualFix(task, result.coverage)
  }

  return null
}

export function developerSnippetsFromFix(fix: ManualFixPayload): ManualFixSnippet[] {
  return fix.snippets.filter((s) =>
    ['redirect-vercel', 'redirect-nextjs', 'redirect-htaccess', 'redirect-nginx', 'html', 'sitemap-xml'].includes(
      s.kind,
    ),
  )
}

/** Resolve a manual-fix payload for a follow-up task (rebuild when cache missing). */
export function resolveManualFixForTask(
  task: SiteFollowUpTask,
  result: IndexDiagnosisResult,
  inboundMap: Map<string, InboundLinkEvidence[]>,
): ManualFixPayload | null {
  return result.manualFixesByTaskId?.[task.id] ?? generateManualFixForTask(task, result, inboundMap)
}
