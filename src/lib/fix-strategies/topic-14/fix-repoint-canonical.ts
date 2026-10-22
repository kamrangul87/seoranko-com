/**
 * Topic 14 — repoint or set self-referential canonical on the PAGE file only.
 * Does not import the verifier. Never writes layout-level metadata.
 *
 * Handles:
 * - HTML: rewrite existing <link rel=canonical>, or insert one when absent
 *   (layout-inherited wrong canonical on the live page).
 * - Next.js page.tsx/ts: set metadata.alternates.canonical on the page file
 *   (overrides cascading layout without editing layout).
 */

import { addHeadCanonical } from '@/lib/fix-strategies/topic-13/fix-add-canonical'

export function setHeadCanonicalHref(
  html: string,
  newAbsoluteUrl: string,
): { html: string; updated: number } {
  let updated = 0
  const next = html.replace(
    /(<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*\bhref\s*=\s*["'])([^"']*)(["'][^>]*>)/gi,
    (_m, pre: string, _old: string, post: string) => {
      updated++
      return `${pre}${newAbsoluteUrl}${post}`
    },
  )
  // Also handle href-before-rel order
  if (updated === 0) {
    const alt = html.replace(
      /(<link\b[^>]*\bhref\s*=\s*["'])([^"']*)(["'][^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>)/gi,
      (_m, pre: string, _old: string, post: string) => {
        updated++
        return `${pre}${newAbsoluteUrl}${post}`
      },
    )
    return { html: alt, updated }
  }
  return { html: next, updated }
}

/**
 * Ensure the page file declares a self-canonical without touching layout.
 */
export function ensurePageSelfCanonical(
  fileContent: string,
  filePath: string,
  selfCanonicalUrl: string,
): { content: string; updated: number } {
  const lower = filePath.toLowerCase()
  const isScript =
    lower.endsWith('.tsx') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.js')

  // Never invent a new static HTML page body — that shadows SPA routes on Vercel.
  if (!fileContent.trim() && /\.html?$/i.test(lower)) {
    return { content: fileContent, updated: 0 }
  }

  if (isScript) {
    return ensureNextPageMetadataCanonical(fileContent, selfCanonicalUrl)
  }

  const rewritten = setHeadCanonicalHref(fileContent, selfCanonicalUrl)
  if (rewritten.updated > 0) {
    return { content: rewritten.html, updated: rewritten.updated }
  }
  // Live HTML may show layout's canonical, but the page file has none —
  // add a page-level <link rel=canonical> so this page alone is corrected.
  const added = addHeadCanonical(fileContent, selfCanonicalUrl)
  return { content: added.html, updated: added.added ? 1 : 0 }
}

/**
 * Set or insert `metadata.alternates.canonical` on a Next.js page module.
 * Never edits layout.* files (caller must pass the page path).
 */
export function ensureNextPageMetadataCanonical(
  source: string,
  selfCanonicalUrl: string,
): { content: string; updated: number } {
  const quoted = JSON.stringify(selfCanonicalUrl)

  // Already has alternates.canonical — replace the value.
  if (/alternates\s*:\s*\{[^}]*canonical\s*:/s.test(source)) {
    const next = source.replace(
      /(alternates\s*:\s*\{[^}]*canonical\s*:\s*)(['"`])([^'"`]*)\2/s,
      `$1${quoted}`,
    )
    if (next !== source) return { content: next, updated: 1 }
    // Object form canonical: { canonical: '...' } nested differently —
    // replace first string after canonical:
    const alt = source.replace(
      /(canonical\s*:\s*)(['"`])([^'"`]*)\2/,
      `$1${quoted}`,
    )
    if (alt !== source) return { content: alt, updated: 1 }
  }

  // Existing `export const metadata = { ... }` — inject alternates.
  const metaObj = source.match(
    /export\s+const\s+metadata\s*=\s*\{([\s\S]*?)\n\}/,
  )
  if (metaObj && metaObj.index != null) {
    const body = metaObj[1] ?? ''
    if (/alternates\s*:/.test(body)) {
      const patchedBody = body.replace(
        /(alternates\s*:\s*\{)/,
        `$1\n    canonical: ${quoted},`,
      )
      const next =
        source.slice(0, metaObj.index) +
        `export const metadata = {${patchedBody}\n}` +
        source.slice(metaObj.index + metaObj[0].length)
      return { content: next, updated: 1 }
    }
    const patchedBody = `${body}\n  alternates: { canonical: ${quoted} },`
    const next =
      source.slice(0, metaObj.index) +
      `export const metadata = {${patchedBody}\n}` +
      source.slice(metaObj.index + metaObj[0].length)
    return { content: next, updated: 1 }
  }

  // No metadata export — prepend a page-level override.
  const insert = `export const metadata = {\n  alternates: { canonical: ${quoted} },\n}\n\n`
  return { content: insert + source, updated: 1 }
}
