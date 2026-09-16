/**
 * Topic 13 — detect absent / body-misplaced canonical.
 *
 * Uses shared `extractCanonicalDeclarations` only.
 * Absence is a finding ONLY when topics 8–12 proved duplicate URL forms.
 */

import {
  extractCanonicalDeclarations,
  hasNoindexDirective,
  resolveCanonicalRepoSites,
  resolveFixTarget,
  resolvePageFileForPath,
  type CanonicalExtraction,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'
import {
  classifyCanonicalAbsent,
  type Topic13Severity,
  type Topic13Verdict,
} from './classify'

export type Topic13Finding = {
  kind: 'canonical/tag-absent' | 'canonical/body-misplaced'
  pageUrl: string
  verdict: Topic13Verdict
  severity: Topic13Severity
  detail: string
  preferredForm: string | null
  extraction: CanonicalExtraction
  fixTarget: FixTargetResult
  repoFiles: string[]
}

export type DetectTopic13Result = {
  findings: Topic13Finding[]
  suppressed: Array<{ pageUrl: string; reason: string; verdict: Topic13Verdict }>
  informational: Array<{ pageUrl: string; detail: string }>
}

export type DetectTopic13Page = {
  url: string
  body: string
  headers?: Headers
  contentType?: string | null
  /**
   * From topics 8–12: duplicate URL forms proven for this page.
   * Required for a finding — never raise absence without this.
   */
  duplicatesProven: boolean
  /** Preferred form from topics 8–12 when known. */
  preferredForm?: string | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export type DetectTopic13Options = {
  appDir?: string
  repoRoot?: string
  /**
   * Override repo-site resolution (fixtures).
   */
  repoSiteByUrl?: Record<
    string,
    {
      kind:
        | 'page'
        | 'layout'
        | 'generateMetadata-indeterminate'
        | 'none'
        | 'unknown'
      files?: string[]
    }
  >
}

function isNonHtml(contentType: string | null | undefined, body: string): boolean {
  if (!contentType) {
    const head = body.slice(0, 256).toLowerCase()
    return !(head.includes('<html') || head.includes('<!doctype html'))
  }
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return false
  return true
}

export function detectCanonicalAbsent(
  pages: DetectTopic13Page[],
  options: DetectTopic13Options = {},
): DetectTopic13Result {
  const findings: Topic13Finding[] = []
  const suppressed: DetectTopic13Result['suppressed'] = []
  const informational: DetectTopic13Result['informational'] = []

  for (const page of pages) {
    const headers = page.headers ?? new Headers()
    const contentType =
      page.contentType ?? headers.get('content-type') ?? 'text/html'
    const extraction = extractCanonicalDeclarations(
      page.body,
      headers,
      page.url,
      contentType,
    )

    const hasNoindex = hasNoindexDirective(headers, page.body, contentType)
    const nonHtml = isNonHtml(contentType, page.body)

    let repoSiteKind:
      | 'page'
      | 'layout'
      | 'generateMetadata-indeterminate'
      | 'none'
      | 'unknown' = 'none'
    let repoFiles: string[] = []

    const override = options.repoSiteByUrl?.[page.url]
    if (override) {
      repoSiteKind = override.kind
      repoFiles = override.files ?? []
    } else if (options.appDir) {
      const routeFile =
        page.artefactPath && options.repoRoot
          ? // prefer explicit artefact when provided as absolute-ish path under app
            resolvePageFileForPath(page.url, options.appDir) ??
            (page.artefactPath.startsWith('/')
              ? page.artefactPath
              : `${options.repoRoot}/${page.artefactPath}`)
          : resolvePageFileForPath(page.url, options.appDir)
      if (routeFile) {
        const site = resolveCanonicalRepoSites(
          routeFile,
          options.appDir,
          options.repoRoot,
        )
        repoSiteKind = site.kind
        repoFiles = site.files
      } else {
        repoSiteKind = 'unknown'
      }
    }

    const classified = classifyCanonicalAbsent({
      absent: extraction.headAbsent && extraction.header.length === 0,
      hasBodyMisplaced: extraction.hasBodyMisplaced,
      headerPresent: extraction.header.length > 0,
      headPresent: extraction.head.length > 0,
      duplicatesProven: page.duplicatesProven,
      preferredForm: page.preferredForm ?? null,
      hasNoindex,
      isNonHtml: nonHtml,
      repoSiteKind,
    })

    const fixTarget = resolveFixTarget({
      artefactPath: page.artefactPath ?? 'app/page.tsx',
      isGenerated: page.isGenerated ?? false,
      generatorPath: page.generatorPath ?? null,
    })

    if (
      classified.verdict === 'ok' ||
      classified.verdict.startsWith('suppress-')
    ) {
      suppressed.push({
        pageUrl: page.url,
        reason: classified.detail,
        verdict: classified.verdict,
      })
      continue
    }

    if (classified.verdict === 'informational-no-duplicates') {
      informational.push({ pageUrl: page.url, detail: classified.detail })
      continue
    }

    if (classified.verdict === 'indeterminate-generateMetadata') {
      findings.push({
        kind: 'canonical/tag-absent',
        pageUrl: page.url,
        verdict: classified.verdict,
        severity: null,
        detail: classified.detail,
        preferredForm: page.preferredForm ?? null,
        extraction,
        fixTarget,
        repoFiles,
      })
      continue
    }

    const kind =
      classified.verdict === 'finding-body-misplaced'
        ? 'canonical/body-misplaced'
        : 'canonical/tag-absent'

    findings.push({
      kind,
      pageUrl: page.url,
      verdict: classified.verdict,
      severity: classified.severity,
      detail: classified.detail,
      preferredForm: page.preferredForm ?? null,
      extraction,
      fixTarget,
      repoFiles,
    })
  }

  return { findings, suppressed, informational }
}
