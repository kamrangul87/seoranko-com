/**
 * Shared canonical extraction for topics 13–17.
 *
 * ONE step used by every canonical topic:
 * - `link[rel=canonical]` elements in `<head>` as the HTML parser sees them
 *   (implicit `</head>` closes head — body-content tags force subsequent
 *   links into `<body>`)
 * - `link[rel=canonical]` elements the parser places in `<body>` (C2: Google
 *   disregards these; they count as ABSENT for topic 13 and as misplaced for
 *   topic 17 — do NOT generalise this to robots meta, which IS respected in
 *   body per topic 67 R8)
 * - HTTP `Link: <…>; rel="canonical"` header values
 *
 * Normalisation for comparison uses `normalizeFixStrategyUrl` (topic 5):
 * must NOT collapse trailing slash, path case, query, or non-default port.
 */

import { parseHtml } from './html-parser'
import { normalizeFixStrategyUrl } from './url-normalize'

export type CanonicalLocation = 'head' | 'body' | 'header'

export type CanonicalDeclaration = {
  /** Raw href / Link URL as declared. */
  raw: string
  /** Normalised absolute URL, or null if unparseable. */
  normalized: string | null
  location: CanonicalLocation
}

export type CanonicalExtraction = {
  /** Declarations the parser places in `<head>`. */
  head: CanonicalDeclaration[]
  /** Declarations the parser places in `<body>` (C2 — disregarded by Google). */
  body: CanonicalDeclaration[]
  /** Declarations from the HTTP Link header. */
  header: CanonicalDeclaration[]
  /**
   * Effective HTML canonical for single-target checks: first head declaration
   * only when exactly one head declaration exists. Body-only does NOT count.
   */
  effectiveHead: CanonicalDeclaration | null
  /** True when head has zero canonicals (body-only ⇒ absent for topic 13). */
  headAbsent: boolean
  /** True when a body canonical exists (own defect). */
  hasBodyMisplaced: boolean
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return /text\/html|application\/xhtml\+xml/i.test(contentType)
}

function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 256).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}

function linkIsCanonical(rel: string | undefined): boolean {
  if (!rel) return false
  return rel
    .toLowerCase()
    .split(/\s+/)
    .some((t) => t === 'canonical')
}

function fromElements(
  els: Array<{ attrs: Record<string, string> }>,
  pageUrl: string,
  location: CanonicalLocation,
): CanonicalDeclaration[] {
  const out: CanonicalDeclaration[] = []
  for (const el of els) {
    if (!linkIsCanonical(el.attrs.rel)) continue
    const href = el.attrs.href?.trim()
    if (!href) continue
    out.push({
      raw: href,
      normalized: normalizeFixStrategyUrl(href, pageUrl),
      location,
    })
  }
  return out
}

/**
 * Parse HTTP Link header(s) for rel=canonical.
 * Supports comma-separated entries (commas inside <> ignored).
 */
export function extractLinkHeaderCanonicals(
  headers: Headers,
  pageUrl: string,
): CanonicalDeclaration[] {
  const single = headers.get('link')
  if (!single) return []

  const out: CanonicalDeclaration[] = []
  for (const part of splitLinkHeader(single)) {
    const m = part.match(/^\s*<([^>]+)>\s*(.*)$/s)
    if (!m) continue
    const url = m[1]!.trim()
    const params = m[2] ?? ''
    if (!linkParamHasCanonicalRel(params)) continue
    out.push({
      raw: url,
      normalized: normalizeFixStrategyUrl(url, pageUrl),
      location: 'header',
    })
  }
  return out
}

function linkParamHasCanonicalRel(params: string): boolean {
  // rel="canonical", rel='canonical', rel=canonical, or multi-token rel="... canonical ..."
  const quoted = params.match(/\brel\s*=\s*"([^"]*)"/i)
  if (quoted) {
    return quoted[1]!
      .toLowerCase()
      .split(/\s+/)
      .includes('canonical')
  }
  const singleQuoted = params.match(/\brel\s*=\s*'([^']*)'/i)
  if (singleQuoted) {
    return singleQuoted[1]!
      .toLowerCase()
      .split(/\s+/)
      .includes('canonical')
  }
  const bare = params.match(/\brel\s*=\s*([^\s;,]+)/i)
  if (bare) {
    return bare[1]!.toLowerCase() === 'canonical'
  }
  return false
}

/**
 * Split a Link header on commas that separate entries, not those inside `<>`.
 */
function splitLinkHeader(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let inAngle = false
  for (const ch of value) {
    if (ch === '<') inAngle = true
    if (ch === '>') inAngle = false
    if (ch === ',' && !inAngle) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * Extract every canonical declaration from a live response.
 * This is the shared step — topics 13/14/16/17 must call this, not reinvent it.
 */
export function extractCanonicalDeclarations(
  body: string,
  headers: Headers,
  pageUrl: string,
  contentType: string | null = null,
): CanonicalExtraction {
  const headerDecls = extractLinkHeaderCanonicals(headers, pageUrl)

  let head: CanonicalDeclaration[] = []
  let bodyDecls: CanonicalDeclaration[] = []

  const parseHtmlTree =
    isHtmlContentType(contentType) || looksLikeHtml(body) || contentType == null

  if (parseHtmlTree && body) {
    const parsed = parseHtml(body)
    head = fromElements(parsed.headElements('link'), pageUrl, 'head')
    bodyDecls = fromElements(parsed.bodyElements('link'), pageUrl, 'body')
  }

  return {
    head,
    body: bodyDecls,
    header: headerDecls,
    // Exactly one head declaration — never "first by document order" when
    // multiple exist (topic 17 owns that case).
    effectiveHead: head.length === 1 ? head[0]! : null,
    headAbsent: head.length === 0,
    hasBodyMisplaced: bodyDecls.length > 0,
  }
}

/**
 * Distinct normalised targets across a set of declarations (skips nulls).
 */
export function distinctNormalizedTargets(
  decls: CanonicalDeclaration[],
): string[] {
  const set = new Set<string>()
  for (const d of decls) {
    if (d.normalized) set.add(d.normalized)
  }
  return Array.from(set)
}
