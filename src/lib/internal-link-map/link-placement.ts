/**
 * Landmark region for an in-page <a href>. Used by live verify and link health.
 */

export type LinkRegion =
  | 'article'
  | 'main'
  | 'nav'
  | 'footer'
  | 'header'
  | 'aside'
  | 'after-body'
  | 'other'

export type PlacedAnchor = {
  href: string
  attrs: string
  inner: string
  text: string
  region: LinkRegion
  nofollow: boolean
  index: number
}

const LANDMARKS = new Set(['article', 'main', 'nav', 'footer', 'header', 'aside', 'body'])
const A_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
const TAG_RE = /<\/?(article|main|nav|footer|header|aside|body)\b[^>]*>/gi
const HREF_RE =
  /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const REL_RE = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

function stripTags(inner: string): string {
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeHrefKey(href: string, pageUrl?: string): string {
  const decoded = href.replace(/&amp;/g, '&').trim()
  try {
    const base = pageUrl || 'https://example.invalid'
    const u = new URL(decoded, base)
    return `${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`
  } catch {
    return decoded.replace(/\/+$/, '') || decoded
  }
}

function regionFromStack(stack: string[], afterBody: boolean): LinkRegion {
  if (afterBody) return 'after-body'
  // Related nav/aside nested in article/main still counts as in-content.
  if (stack.includes('article')) return 'article'
  if (stack.includes('main')) return 'main'
  for (let i = stack.length - 1; i >= 0; i--) {
    const tag = stack[i]
    if (tag === 'nav') return 'nav'
    if (tag === 'footer') return 'footer'
    if (tag === 'header') return 'header'
    if (tag === 'aside') return 'aside'
  }
  return 'other'
}

function landmarksAt(html: string, at: number): { stack: string[]; afterBody: boolean } {
  const stack: string[] = []
  let afterBody = false
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(html))) {
    if (m.index >= at) break
    const raw = m[0]
    const tag = (m[1] || '').toLowerCase()
    if (!LANDMARKS.has(tag)) continue
    if (raw.startsWith('</')) {
      if (tag === 'body') afterBody = true
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === tag) {
          stack.splice(i, 1)
          break
        }
      }
    } else if (!raw.endsWith('/>')) {
      stack.push(tag)
    }
  }
  return { stack, afterBody }
}

export function extractPlacedAnchors(html: string): PlacedAnchor[] {
  if (!html) return []
  const out: PlacedAnchor[] = []
  A_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = A_RE.exec(html))) {
    const attrs = m[1] ?? ''
    const inner = m[2] ?? ''
    const hrefMatch = attrs.match(HREF_RE)
    const href = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '').trim()
    if (!href) continue
    const relMatch = attrs.match(REL_RE)
    const rel = (relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? '').trim()
    const { stack, afterBody } = landmarksAt(html, m.index)
    out.push({
      href,
      attrs,
      inner,
      text: stripTags(inner),
      region: regionFromStack(stack, afterBody),
      nofollow: /\bnofollow\b/i.test(rel),
      index: m.index,
    })
  }
  return out
}

export function anchorsMatchingHref(
  html: string,
  href: string,
  pageUrl?: string,
): PlacedAnchor[] {
  const key = normalizeHrefKey(href, pageUrl)
  return extractPlacedAnchors(html).filter(
    (a) => normalizeHrefKey(a.href, pageUrl) === key,
  )
}

export function isContentRegion(region: LinkRegion): boolean {
  return region === 'article' || region === 'main'
}

export function isChromeRegion(region: LinkRegion): boolean {
  return region === 'nav' || region === 'footer' || region === 'header'
}
