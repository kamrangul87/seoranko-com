/**
 * Topic 25 — sitemap XML invalid.
 *
 * Classifies from SitemapInspection documents. changefreq/priority are
 * informational only (S7). Never rewrite lastmod. 50 MB limit is on
 * DECOMPRESSED size (S11). loc must be under 2,048 characters (S3).
 */

import {
  type SitemapInspection,
  type SitemapDocument,
  SITEMAP_MAX_LOC_CHARS,
  SITEMAP_MAX_URLS,
} from '@/lib/fix-strategies/shared/sitemap-inspect'
import {
  ensureSitemapNamespace,
  isAbsoluteHttpLoc,
  absolutizeLoc,
  stripChangefreqAndPriority,
  escapeXmlText,
  SITEMAP_NAMESPACE,
} from '@/lib/fix-strategies/shared/sitemap-xml'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic25Verdict =
  | 'ok'
  | 'critical-wrong-namespace'
  | 'critical-xml-unparseable'
  | 'critical-not-utf8'
  | 'auto-fix-relative-loc'
  | 'auto-remove-locless-entry'
  | 'auto-escape-entities'
  | 'informational-changefreq-priority'
  | 'high-loc-too-long'
  | 'high-over-url-limit'
  | 'high-over-size-limit'
  | 'high-index-over-limit'
  | 'moderate-bulk-identical-lastmod'
  | 'moderate-out-of-scope'
  | 'suppress-valid-index'

export type Topic25Finding = {
  kind: 'sitemap/xml-invalid'
  verdict: Topic25Verdict
  severity: 'critical' | 'high' | 'moderate' | 'informational' | null
  sitemapUrl: string
  detail: string
  autoFixable: boolean
  /** Never auto-rewrite lastmod. */
  lastmodRewriteRejected: true
  fixTarget: FixTargetResult
  loc?: string
}

export type DetectTopic25Result = {
  findings: Topic25Finding[]
  informational: Topic25Finding[]
  suppressed: Array<{ sitemapUrl: string; verdict: Topic25Verdict; detail: string }>
}

export type DetectTopic25Options = {
  inspection: SitemapInspection
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /** Established cross-submission hosts (S6) — suppress out-of-scope. */
  crossSubmissionHosts?: string[]
}

export function detectSitemapXmlInvalid(
  options: DetectTopic25Options,
): DetectTopic25Result {
  const findings: Topic25Finding[] = []
  const informational: Topic25Finding[] = []
  const suppressed: DetectTopic25Result['suppressed'] = []

  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/sitemap.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/sitemap.ts',
  })

  for (const doc of options.inspection.documents) {
    if (doc.fetchOutcome !== 'ok' || !doc.parsed) continue

    classifyDocument(doc, fixTarget, options, findings, informational, suppressed)
  }

  return { findings, informational, suppressed }
}

function classifyDocument(
  doc: SitemapDocument,
  fixTarget: FixTargetResult,
  options: DetectTopic25Options,
  findings: Topic25Finding[],
  informational: Topic25Finding[],
  suppressed: DetectTopic25Result['suppressed'],
): void {
  const parsed = doc.parsed!
  const push = (
    verdict: Topic25Verdict,
    severity: Topic25Finding['severity'],
    detail: string,
    autoFixable: boolean,
    loc?: string,
  ) => {
    const row: Topic25Finding = {
      kind: 'sitemap/xml-invalid',
      verdict,
      severity,
      sitemapUrl: doc.url,
      detail,
      autoFixable,
      lastmodRewriteRejected: true,
      fixTarget,
      loc,
    }
    if (verdict === 'informational-changefreq-priority') informational.push(row)
    else findings.push(row)
  }

  if (!parsed.appearsUtf8) {
    push('critical-not-utf8', 'critical', 'Sitemap is not UTF-8 (S1)', false)
  }

  if (!parsed.xmlParses) {
    push(
      'critical-xml-unparseable',
      'critical',
      'XML does not parse as urlset/sitemapindex (S1)',
      false,
    )
    return
  }

  if (parsed.kind === 'sitemapindex') {
    if (!parsed.namespaceOk) {
      push(
        'critical-wrong-namespace',
        'critical',
        `Wrong/missing namespace on sitemapindex (got ${parsed.namespace ?? 'none'}; need ${SITEMAP_NAMESPACE})`,
        true,
      )
    }
    if (parsed.indexEntries.length > SITEMAP_MAX_URLS) {
      push(
        'high-index-over-limit',
        'high',
        `Sitemap index lists ${parsed.indexEntries.length} sitemaps (max ${SITEMAP_MAX_URLS}) (S12)`,
        false,
      )
    }
    if (doc.exceedsSizeLimit) {
      push(
        'high-over-size-limit',
        'high',
        `Decompressed size ${doc.decompressedByteLength} exceeds 50 MB` +
          (doc.wasGzip
            ? ` (compressed wire ${doc.compressedByteLength})`
            : '') +
          ' (S11)',
        false,
      )
    }
    if (
      parsed.namespaceOk &&
      parsed.indexEntries.length <= SITEMAP_MAX_URLS &&
      !doc.exceedsSizeLimit
    ) {
      suppressed.push({
        sitemapUrl: doc.url,
        verdict: 'suppress-valid-index',
        detail: 'Valid sitemap index — validated against index schema, not urlset',
      })
    }
    return
  }

  // urlset
  if (!parsed.namespaceOk) {
    push(
      'critical-wrong-namespace',
      'critical',
      `Wrong/missing urlset namespace (got ${parsed.namespace ?? 'none'})`,
      true,
    )
  }

  if (parsed.hasUnescapedEntities) {
    push(
      'auto-escape-entities',
      'high',
      'Unescaped entities in sitemap values (S1)',
      true,
    )
  }

  if (doc.exceedsSizeLimit) {
    push(
      'high-over-size-limit',
      'high',
      `Decompressed size ${doc.decompressedByteLength} exceeds 50 MB` +
        (doc.wasGzip
          ? ` (gzip wire ${doc.compressedByteLength} bytes)`
          : '') +
        ' — limit is on decompressed file (S11)',
      false,
    )
  }

  if (parsed.urlEntries.length > SITEMAP_MAX_URLS) {
    push(
      'high-over-url-limit',
      'high',
      `${parsed.urlEntries.length} URL entries exceeds ${SITEMAP_MAX_URLS} (S9)`,
      false,
    )
  }

  if (parsed.hasChangefreq || parsed.hasPriority) {
    push(
      'informational-changefreq-priority',
      'informational',
      'changefreq/priority present — protocol-valid; Google ignores (S7). Not an error.',
      true, // cleanup safe
    )
  }

  if (parsed.lastmodBulkIdentical) {
    push(
      'moderate-bulk-identical-lastmod',
      'moderate',
      'lastmod identical across all entries — Google may stop trusting it (S8). Never auto-rewrite lastmod.',
      false,
    )
  }

  let sitemapHost: string | null = null
  try {
    sitemapHost = new URL(doc.url).host.toLowerCase()
  } catch {
    sitemapHost = null
  }
  const cross = new Set(
    (options.crossSubmissionHosts ?? []).map((h) => h.toLowerCase()),
  )

  for (const entry of parsed.urlEntries) {
    if (entry.loc == null) {
      push(
        'auto-remove-locless-entry',
        'high',
        'url entry with no loc (S2)',
        true,
      )
      continue
    }

    if (entry.loc.length > SITEMAP_MAX_LOC_CHARS) {
      push(
        'high-loc-too-long',
        'high',
        `loc length ${entry.loc.length} exceeds ${SITEMAP_MAX_LOC_CHARS} (S3)`,
        false,
        entry.loc.slice(0, 80) + '…',
      )
    }

    if (!isAbsoluteHttpLoc(entry.loc)) {
      push(
        'auto-fix-relative-loc',
        'high',
        `loc is relative or lacks protocol: ${entry.loc} (S3)`,
        true,
        entry.loc,
      )
      continue
    }

    if (sitemapHost) {
      try {
        const host = new URL(entry.loc).host.toLowerCase()
        if (host !== sitemapHost && !cross.has(host)) {
          push(
            'moderate-out-of-scope',
            'moderate',
            `loc host ${host} outside sitemap host ${sitemapHost} (S5/S6)`,
            false,
            entry.loc,
          )
        }
      } catch {
        // ignore
      }
    }
  }

  if (
    findings.filter((f) => f.sitemapUrl === doc.url).length === 0 &&
    informational.filter((f) => f.sitemapUrl === doc.url).length === 0
  ) {
    suppressed.push({
      sitemapUrl: doc.url,
      verdict: 'ok',
      detail: 'Valid urlset',
    })
  }
}

/** Apply auto-fixable structural transforms. Never rewrites lastmod. */
export function applyTopic25AutoFixes(
  sitemapXml: string,
  sitemapUrl: string,
): { xml: string; notes: string[] } {
  let xml = sitemapXml
  const notes: string[] = []

  const beforeNs = xml
  xml = ensureSitemapNamespace(xml)
  if (xml !== beforeNs) notes.push('ensured sitemap namespace')

  // Remove loc-less url blocks
  xml = xml.replace(/<url\b[^>]*>[\s\S]*?<\/url\s*>/gi, (block) => {
    if (!/<loc\s*>/i.test(block)) {
      notes.push('removed loc-less url entry')
      return ''
    }
    return block
  })

  // Absolutize relative locs
  xml = xml.replace(
    /<loc\s*>([\s\S]*?)<\/loc\s*>/gi,
    (_m, inner: string) => {
      const loc = inner.trim()
      if (isAbsoluteHttpLoc(loc)) return `<loc>${escapeXmlText(loc)}</loc>`
      const abs = absolutizeLoc(loc, sitemapUrl)
      if (abs) {
        notes.push(`absolutized loc ${loc}`)
        return `<loc>${escapeXmlText(abs)}</loc>`
      }
      return `<loc>${inner}</loc>`
    },
  )

  const stripped = stripChangefreqAndPriority(xml)
  if (stripped !== xml) {
    notes.push('removed changefreq/priority (ignored by Google)')
    xml = stripped
  }

  return { xml: xml.replace(/\n{3,}/g, '\n\n'), notes }
}

/** REJECTED — fabricating lastmod is worse than inaccurate ones. */
export function rejectedRewriteLastmod(): never {
  throw new Error(
    'REJECTED: never rewrite lastmod values — fabricating dates is worse than inaccurate ones (S8)',
  )
}
