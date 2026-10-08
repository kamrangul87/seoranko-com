/**
 * Resolve a live URL + evidence string to exactly one static repo file.
 *
 * Generalises topic-49's Contents-API path target: detect static roots from
 * the connected branch tree (never assume `public/`), build candidates
 * (p / p.html / p/index.html), then accept only when exactly one candidate
 * exists and its content contains the evidence needle exactly
 * `expectedCount` times. No fallback, no best guess.
 */

import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'

export type SourceUnresolvedReason =
  | 'no-static-file'
  | 'multiple-candidates'
  | 'evidence-not-found'
  | 'evidence-ambiguous'

export type SourceEvidence = {
  /** Exact substring that must appear in the file. */
  needle: string
  /** Exact occurrence count required (default 1). */
  expectedCount: number
}

export type ResolveSourceFileInput = {
  /** Absolute page / artefact URL (e.g. https://autodun.com/blog). */
  url: string
  evidence: SourceEvidence
  /** Blob paths from GET .../git/trees/{branch}?recursive=1 */
  treePaths: string[]
  /** Read file content for a path that exists in the tree. */
  readFile: (path: string) => Promise<string | null>
  /** Optional: blob SHA from the tree entry (preferred over re-fetch). */
  treeShas?: Record<string, string>
}

export type ResolveSourceFileResult =
  | {
      status: 'resolved'
      path: string
      blobSha: string
      resolvedAt: string
    }
  | {
      status: 'unresolved'
      reason: SourceUnresolvedReason
      resolvedAt: string
      candidates?: string[]
    }

const STATIC_ARTEFACT = /(^|\/)(robots\.txt|sitemap\.xml|.*\.html?)$/i

/** Directories that commonly hold statically served artefacts. */
const KNOWN_STATIC_ROOT_NAMES = [
  'public',
  'static',
  'www',
  'dist',
  'out',
  'docs',
] as const

function isStaticArtefactPath(path: string): boolean {
  return STATIC_ARTEFACT.test(path)
}

/**
 * Detect static roots from the repo tree. Never hardcodes a single root —
 * returns every directory (plus repo root) that holds static artefacts.
 */
export function detectStaticRoots(treePaths: string[]): string[] {
  const pathSet = new Set(treePaths)
  const roots = new Set<string>()

  for (const name of KNOWN_STATIC_ROOT_NAMES) {
    const prefix = `${name}/`
    if (
      treePaths.some((p) => p.startsWith(prefix) && isStaticArtefactPath(p))
    ) {
      roots.add(name)
    }
  }

  // Repo root artefacts (fixture sites, plain static hosts).
  if (treePaths.some((p) => !p.includes('/') && isStaticArtefactPath(p))) {
    roots.add('')
  }

  // First-level dirs that hold site-level artefacts (robots / sitemap).
  // Do NOT promote content dirs that only have index.html (e.g. blog/) —
  // those are pages under the static root, not alternate roots. Promoting
  // them made URL "/" resolve to both index.html and blog/index.html.
  for (const p of treePaths) {
    const m = p.match(/^([^/]+)\/(robots\.txt|sitemap\.xml)$/i)
    if (m) roots.add(m[1]!)
  }

  // Any parent of a static artefact that is itself a known name or root.
  for (const p of pathSet) {
    if (!isStaticArtefactPath(p)) continue
    const parts = p.split('/')
    if (parts.length >= 2 && KNOWN_STATIC_ROOT_NAMES.includes(parts[0] as (typeof KNOWN_STATIC_ROOT_NAMES)[number])) {
      roots.add(parts[0]!)
    }
  }

  return Array.from(roots).sort((a, b) => {
    // Prefer non-empty roots; stable lexicographic otherwise.
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })
}

function urlPathname(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/**
 * Candidate repo-relative paths for a URL under the given static roots.
 * For /sitemap.xml and /robots.txt: literal filename only.
 * Otherwise for path p: p, p.html, p/index.html (and bare index.html for /).
 */
export function candidatePathsForUrl(
  url: string,
  staticRoots: string[],
): string[] {
  const pathname = urlPathname(url)
  if (pathname == null) return []

  let p = pathname.replace(/^\//, '')
  // Normalise trailing slash: /blog/ → blog
  if (p.endsWith('/')) p = p.slice(0, -1)

  const rels: string[] = []
  if (p === 'sitemap.xml' || p === 'robots.txt') {
    rels.push(p)
  } else if (!p) {
    rels.push('index.html')
  } else if (/\.html?$/i.test(p)) {
    rels.push(p)
    // Also allow directory-index form when URL was …/foo.html
    const withoutExt = p.replace(/\.html?$/i, '')
    if (withoutExt) rels.push(`${withoutExt}/index.html`)
  } else {
    rels.push(p)
    rels.push(`${p}.html`)
    rels.push(`${p}/index.html`)
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (const root of staticRoots) {
    for (const rel of rels) {
      const full = root ? `${root}/${rel}` : rel
      if (!seen.has(full)) {
        seen.add(full)
        out.push(full)
      }
    }
  }
  return out
}

export function countExactOccurrences(content: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  while (from <= content.length) {
    const i = content.indexOf(needle, from)
    if (i === -1) break
    count++
    from = i + needle.length
  }
  return count
}

/** Strip HTML comments, scripts, and styles so evidence ignores non-markup text. */
export function stripNonMarkupNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
}

export type RelevantAttrKind = 'a-href' | 'link-canonical' | 'img-src'

/**
 * Parsed attribute values from the relevant elements only:
 * `a[href]`, `link[rel=canonical]`, `img[src]`. Comments/scripts/text ignored.
 */
export function extractRelevantAttributeValues(html: string): Array<{
  kind: RelevantAttrKind
  value: string
}> {
  const cleaned = stripNonMarkupNoise(html)
  const out: Array<{ kind: RelevantAttrKind; value: string }> = []

  const aRe = /<a\b[^>]*\bhref\s*=\s*(["'])([^"']*)\1[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = aRe.exec(cleaned)) !== null) {
    if (m[2]) out.push({ kind: 'a-href', value: m[2] })
  }

  const linkRe = /<link\b[^>]*>/gi
  while ((m = linkRe.exec(cleaned)) !== null) {
    const tag = m[0]!
    if (!/\brel\s*=\s*(["'])canonical\1/i.test(tag)) continue
    const href = tag.match(/\bhref\s*=\s*(["'])([^"']*)\1/i)
    if (href?.[2]) out.push({ kind: 'link-canonical', value: href[2] })
  }

  const imgRe = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']*)\1[^>]*>/gi
  while ((m = imgRe.exec(cleaned)) !== null) {
    if (m[2]) out.push({ kind: 'img-src', value: m[2] })
  }

  return out
}

function attrValueMatchesNeedle(
  attrValue: string,
  needle: string,
  pageUrl: string,
): boolean {
  if (attrValue === needle) return true
  const needleNorm = normalizeFixStrategyUrl(needle, pageUrl)
  const attrNorm = normalizeFixStrategyUrl(attrValue, pageUrl)
  if (needleNorm && attrNorm && needleNorm === attrNorm) return true
  return false
}

/**
 * Count attribute values (a[href], link[rel=canonical], img[src]) that match
 * the needle as written or as a URL-equivalent form against `pageUrl`.
 */
export function countUrlEquivalentAttributeMatches(
  content: string,
  targetUrl: string,
  pageUrl: string,
): number {
  return extractRelevantAttributeValues(content).filter((a) =>
    attrValueMatchesNeedle(a.value, targetUrl, pageUrl),
  ).length
}

function looksLikeUrlOrPathNeedle(needle: string): boolean {
  return (
    /^https?:\/\//i.test(needle) ||
    needle.startsWith('/') ||
    /^[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(needle)
  )
}

/**
 * Evidence match count for resolveSourceFile.
 * URL/path needles prefer real markup attributes (a[href], link[canonical],
 * img[src]) so HTML comments/text never inflate the count. When no such
 * attribute matches (e.g. sitemap `<loc>`), fall back to exact substring on
 * comment-stripped content.
 */
export function countEvidenceOccurrences(
  content: string,
  needle: string,
  pageUrl: string,
): number {
  const cleaned = stripNonMarkupNoise(content)
  if (looksLikeUrlOrPathNeedle(needle)) {
    const attrCount = countUrlEquivalentAttributeMatches(
      content,
      needle,
      pageUrl,
    )
    if (attrCount > 0) return attrCount
    return countExactOccurrences(cleaned, needle)
  }
  return countExactOccurrences(cleaned, needle)
}

/**
 * Plain-English why-not-fixed sentence per unresolved reason.
 */
export function whySourceUnresolved(reason: SourceUnresolvedReason): string {
  switch (reason) {
    case 'no-static-file':
      return 'No matching static file in the connected repo — this page is likely framework-rendered or generated, so SEORANKO will not edit it automatically.'
    case 'multiple-candidates':
      return 'More than one static file could match this URL, so SEORANKO will not guess which file to edit.'
    case 'evidence-not-found':
      return 'The expected evidence string was not found in the candidate file, so SEORANKO will not apply a fix automatically.'
    case 'evidence-ambiguous':
      return 'The evidence string appears an unexpected number of times in the file, so SEORANKO will not apply a fix automatically.'
    default:
      return 'SEORANKO could not resolve a single editable source file for this finding.'
  }
}

export async function resolveSourceFile(
  input: ResolveSourceFileInput,
): Promise<ResolveSourceFileResult> {
  const resolvedAt = new Date().toISOString()
  const { url, evidence } = input

  if (!evidence.needle || evidence.expectedCount < 1) {
    return {
      status: 'unresolved',
      reason: 'evidence-not-found',
      resolvedAt,
    }
  }

  const pathSet = new Set(input.treePaths)
  const roots = detectStaticRoots(input.treePaths)
  if (roots.length === 0) {
    return {
      status: 'unresolved',
      reason: 'no-static-file',
      resolvedAt,
      candidates: [],
    }
  }

  const candidates = candidatePathsForUrl(url, roots).filter((p) =>
    pathSet.has(p),
  )

  if (candidates.length === 0) {
    return {
      status: 'unresolved',
      reason: 'no-static-file',
      resolvedAt,
      candidates: [],
    }
  }

  if (candidates.length > 1) {
    return {
      status: 'unresolved',
      reason: 'multiple-candidates',
      resolvedAt,
      candidates,
    }
  }

  const path = candidates[0]!
  const content = await input.readFile(path)
  if (content == null) {
    return {
      status: 'unresolved',
      reason: 'no-static-file',
      resolvedAt,
      candidates: [path],
    }
  }

  const count = countEvidenceOccurrences(content, evidence.needle, url)
  if (count === 0) {
    return {
      status: 'unresolved',
      reason: 'evidence-not-found',
      resolvedAt,
      candidates: [path],
    }
  }
  if (count !== evidence.expectedCount) {
    return {
      status: 'unresolved',
      reason: 'evidence-ambiguous',
      resolvedAt,
      candidates: [path],
    }
  }

  const blobSha =
    input.treeShas?.[path] ??
    // Caller should supply tree SHAs; without one we cannot mark resolved.
    ''
  if (!blobSha) {
    return {
      status: 'unresolved',
      reason: 'no-static-file',
      resolvedAt,
      candidates: [path],
    }
  }

  return {
    status: 'resolved',
    path,
    blobSha,
    resolvedAt,
  }
}
