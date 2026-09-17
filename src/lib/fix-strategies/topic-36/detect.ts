/**
 * Topic 36 — schema URLs that do not resolve.
 *
 * @id values are graph IDENTIFIERS — never raise on them.
 * Never remove a REQUIRED url property to clear a finding.
 */

import {
  collectUrlProperties,
  extractStructuredData,
  type StructuredDataExtraction,
  type StructuredDataNode,
} from '@/lib/fix-strategies/shared/structured-data-extract'
import { lookupRequirement } from '@/lib/fix-strategies/shared/structured-data-requirement-table'
import {
  isPathAllowedFromInspection,
  type RobotsTxtInspection,
} from '@/lib/fix-strategies/shared/robots-txt-inspect'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'
import { isAbsoluteHttpLoc } from '@/lib/fix-strategies/shared/sitemap-xml'

export type Topic36Verdict =
  | 'ok'
  | 'auto-absolutize-relative'
  | 'auto-repoint-redirect'
  | 'auto-remove-dead-recommended'
  | 'high-dead-required-url'
  | 'moderate-dead-recommended'
  | 'human-review-robots-disallow'
  | 'suppress-at-id-identifier'
  | 'suppress-live-external-profile'
  | 'route-topic-3-transient-5xx'
  | 'format-unsupported'

export type Topic36UrlProbe = {
  url: string
  status: number | null
  redirectHops?: number
  finalUrl?: string | null
  /** Confirmed stable non-200 (topic 68). */
  confirmed?: boolean
  transient5xx?: boolean
  contentType?: string | null
}

export type Topic36Finding = {
  kind: 'structured-data/urls-dont-resolve'
  verdict: Topic36Verdict
  severity: 'high' | 'moderate' | 'low' | null
  propertyPath: string
  url: string
  detail: string
  autoFixable: boolean
  /** Never true for @id. */
  isAtId: false
  fixTarget: FixTargetResult
}

export type DetectTopic36Result = {
  findings: Topic36Finding[]
  suppressed: Array<{ verdict: Topic36Verdict; detail: string; url?: string }>
  extraction: StructuredDataExtraction
}

export type DetectTopic36Options = {
  html: string
  pageUrl: string
  extraction?: StructuredDataExtraction
  /** Probe results keyed by absolute URL. */
  probes?: Record<string, Topic36UrlProbe>
  robots?: RobotsTxtInspection | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

const IMAGE_FORMATS = /image\/(jpeg|jpg|png|gif|webp|bmp|svg\+xml)/i

export function detectSchemaUrlsDontResolve(
  options: DetectTopic36Options,
): DetectTopic36Result {
  const extraction =
    options.extraction ??
    extractStructuredData(options.html, options.pageUrl)
  const findings: Topic36Finding[] = []
  const suppressed: DetectTopic36Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/schema.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/schema.ts',
  })
  const probes = options.probes ?? {}

  // Explicitly never raise on @id
  for (const node of extraction.nodes) {
    if (node.id) {
      suppressed.push({
        verdict: 'suppress-at-id-identifier',
        detail: `@id is a graph identifier, not an address — never raise (${node.id})`,
        url: node.id,
      })
    }

    const urls = collectUrlProperties(node)
    for (const { path, value } of urls) {
      classifyUrl(node, path, value, options, probes, fixTarget, findings, suppressed)
    }
  }

  return { findings, suppressed, extraction }
}

function classifyUrl(
  node: StructuredDataNode,
  path: string,
  value: string,
  options: DetectTopic36Options,
  probes: Record<string, Topic36UrlProbe>,
  fixTarget: FixTargetResult,
  findings: Topic36Finding[],
  suppressed: DetectTopic36Result['suppressed'],
): void {
  const make = (
    verdict: Topic36Verdict,
    severity: Topic36Finding['severity'],
    detail: string,
    autoFixable: boolean,
  ): Topic36Finding => ({
    kind: 'structured-data/urls-dont-resolve',
    verdict,
    severity,
    propertyPath: path,
    url: value,
    detail,
    autoFixable,
    isAtId: false,
    fixTarget,
  })

  if (!isAbsoluteHttpLoc(value)) {
    // Relative — defect
    let abs: string | undefined
    try {
      abs = new URL(value, options.pageUrl).href
    } catch {
      abs = undefined
    }
    findings.push(
      make(
        'auto-absolutize-relative',
        'high',
        `Relative URL in structured data (${path}) — absolutise` +
          (abs ? ` → ${abs}` : ''),
        true,
      ),
    )
    return
  }

  // Robots disallow for Googlebot
  if (options.robots) {
    try {
      const pathOnly = new URL(value).pathname
      const allowed = isPathAllowedFromInspection(
        options.robots,
        'Googlebot',
        pathOnly,
      )
      if (!allowed.allowed) {
        findings.push(
          make(
            'human-review-robots-disallow',
            'high',
            `URL disallowed for Googlebot (${allowed.matchedRule}) — intent between markup and robots.txt`,
            false,
          ),
        )
        return
      }
    } catch {
      // ignore
    }
  }

  const probe = probes[value]
  if (!probe) {
    // No probe — external live profiles with no evidence → suppress raise
    if (/author\.url|sameAs/i.test(path)) {
      suppressed.push({
        verdict: 'suppress-live-external-profile',
        detail: `${path} external profile not probed — only raise on confirmed 4xx`,
        url: value,
      })
    }
    return
  }

  if (probe.transient5xx) {
    findings.push(
      make(
        'route-topic-3-transient-5xx',
        null,
        'Transient 5xx on schema URL — topic 3',
        false,
      ),
    )
    return
  }

  if (
    probe.redirectHops === 1 &&
    probe.finalUrl &&
    probe.status === 200
  ) {
    findings.push(
      make(
        'auto-repoint-redirect',
        'moderate',
        `Single-hop redirect → repoint ${path} at ${probe.finalUrl}`,
        true,
      ),
    )
    return
  }

  if (probe.status === 200) {
    const ct = probe.contentType ?? ''
    if (/image/i.test(path) && ct && !IMAGE_FORMATS.test(ct)) {
      findings.push(
        make(
          'format-unsupported',
          'moderate',
          `Image URL resolves but unsupported format (${ct}) (D9)`,
          false,
        ),
      )
    }
    if (/author\.url|sameAs/i.test(path)) {
      suppressed.push({
        verdict: 'suppress-live-external-profile',
        detail: `${path} live external profile — ok`,
        url: value,
      })
    }
    return
  }

  if (
    probe.confirmed &&
    probe.status != null &&
    probe.status >= 400 &&
    probe.status < 500
  ) {
    const role = propertyRole(node, path)
    if (role === 'required') {
      findings.push(
        make(
          'high-dead-required-url',
          'high',
          `Required URL property ${path} returns ${probe.status} — do NOT remove (trades defect for ineligibility). Replacement is content decision.`,
          false,
        ),
      )
    } else if (role === 'recommended') {
      findings.push(
        make(
          'auto-remove-dead-recommended',
          'moderate',
          `Recommended URL property ${path} returns confirmed ${probe.status} — removable`,
          true,
        ),
      )
    } else {
      findings.push(
        make(
          'moderate-dead-recommended',
          'low',
          `URL property ${path} returns confirmed ${probe.status}`,
          false,
        ),
      )
    }
  }
}

function propertyRole(
  node: StructuredDataNode,
  path: string,
): 'required' | 'recommended' | 'other' {
  const leaf = path.split(/[.[\]]/).filter(Boolean)[0] ?? path
  for (const t of node.types) {
    const req = lookupRequirement(t)
    if (!req) continue
    if (req.required.some((p) => p === path || p === leaf || path.startsWith(p))) {
      return 'required'
    }
    if (
      req.recommended.some((p) => p === path || p === leaf || path.startsWith(p))
    ) {
      return 'recommended'
    }
  }
  return 'other'
}

/** REJECTED — never remove a required URL to clear the finding. */
export function rejectedRemoveRequiredUrl(): never {
  throw new Error(
    'REJECTED: removing a required URL property trades a defect for ineligibility (D1)',
  )
}

/** REJECTED — never raise on @id. */
export function rejectedRaiseOnAtId(): never {
  throw new Error(
    'REJECTED: @id values are graph identifiers, not addresses — never raise',
  )
}
