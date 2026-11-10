/**
 * Deterministic "Related articles" block for blog pages with no in-content
 * internal links. Reuses an existing related nav/aside/section when present.
 */

import {
  cleanRelatedAnchor,
  escapeHtmlAttr,
  escapeHtmlText,
} from './anchors'

export type RelatedTarget = {
  href: string
  anchorText: string
  h1?: string | null
  title?: string | null
}

export const RELATED_MARKER = 'data-seoranko-related-articles'
export const MAX_RELATED_TARGETS = 5
const DEFAULT_BLOCK_STYLE = 'max-width:780px;margin:48px auto 0;padding:0 24px;'

type RelatedBlock = {
  tag: string
  start: number
  end: number
  attrs: string
  inner: string
  isSeoranko: boolean
}

function normHref(href: string): string {
  const decoded = href
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
  try {
    if (/^https?:\/\//i.test(decoded)) {
      const u = new URL(decoded)
      return `${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`
    }
  } catch {
    /* keep */
  }
  return decoded.replace(/\/+$/, '') || decoded
}

function isRelatedOpening(attrs: string): boolean {
  if (new RegExp(`\\b${RELATED_MARKER}\\b`, 'i').test(attrs)) return true
  if (/\bclass\s*=\s*(["'])[^"']*related[^"']*\1/i.test(attrs)) return true
  if (/\baria-label\s*=\s*(["'])[^"']*related[^"']*\1/i.test(attrs)) return true
  return false
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function findMatchingClose(html: string, tag: string, from: number): number {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi')
  let depth = 1
  let i = from
  while (i < html.length && depth > 0) {
    openRe.lastIndex = i
    closeRe.lastIndex = i
    const open = openRe.exec(html)
    const close = closeRe.exec(html)
    if (!close) return -1
    if (open && open.index < close.index) {
      depth += 1
      i = open.index + open[0].length
    } else {
      depth -= 1
      i = close.index + close[0].length
      if (depth === 0) return i
    }
  }
  return -1
}

function findRelatedBlocks(html: string): RelatedBlock[] {
  const re = /<(nav|aside|section|div)\b([^>]*)>/gi
  const out: RelatedBlock[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[1]!
    const attrs = m[2] || ''
    if (!isRelatedOpening(attrs)) continue
    const close = findMatchingClose(html, tag, m.index + m[0].length)
    if (close < 0) continue
    out.push({
      tag,
      start: m.index,
      end: close,
      attrs,
      inner: html.slice(m.index + m[0].length, close - `</${tag}>`.length),
      isSeoranko: new RegExp(`\\b${RELATED_MARKER}\\b`, 'i').test(attrs),
    })
  }
  return out
}

/**
 * Related h2/h3/h4 whose following sibling is a list (or a run of <a> tags).
 * Used when the page has no related nav/aside/section/div wrapper.
 */
function findRelatedHeadingHosts(html: string): RelatedBlock[] {
  const re = /<h([2-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi
  const out: RelatedBlock[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const text = stripTags(m[3] || '')
    if (!/^related\b/i.test(text)) continue
    const after = m.index + m[0].length
    const rest = html.slice(after)
    const boundary = rest.search(/<(h[1-4]|footer)\b/i)
    const window = rest.slice(0, boundary >= 0 ? boundary : Math.min(rest.length, 5000))
    const listOpen = window.match(/<(ul|ol)\b([^>]*)>/i)
    if (listOpen && listOpen.index != null) {
      const tag = listOpen[1]!
      const listStart = after + listOpen.index
      const close = findMatchingClose(html, tag, listStart + listOpen[0].length)
      if (close < 0) continue
      out.push({
        tag,
        start: listStart,
        end: close,
        attrs: listOpen[2] || '',
        inner: html.slice(listStart + listOpen[0].length, close - `</${tag}>`.length),
        isSeoranko: false,
      })
      continue
    }
    const firstA = window.search(/<a\b/i)
    if (firstA < 0) continue
    const run = window.slice(firstA)
    const lastClose = [...run.matchAll(/<\/a>/gi)].pop()
    if (!lastClose || lastClose.index == null) continue
    const runEnd = after + firstA + lastClose.index + lastClose[0].length
    const runStart = after + firstA
    out.push({
      tag: 'a-run',
      start: runStart,
      end: runEnd,
      attrs: '',
      inner: html.slice(runStart, runEnd),
      isSeoranko: false,
    })
  }
  return out
}

function hrefsIn(html: string): Set<string> {
  const set = new Set<string>()
  const re = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    set.add(normHref(m[2] || ''))
  }
  return set
}

function anchorItemHtml(hostInner: string, href: string, text: string): string {
  const a = hostInner.match(/<a\b([^>]*)>[\s\S]*?<\/a>/i)
  const escHref = escapeHtmlAttr(href)
  const escText = escapeHtmlText(text)
  if (!a) return `<a href="${escHref}">${escText}</a>`
  let aAttrs = a[1] ?? ''
  if (/\bhref\s*=/i.test(aAttrs)) {
    aAttrs = aAttrs.replace(/\bhref\s*=\s*(["']).*?\1/i, `href="${escHref}"`)
  } else {
    aAttrs = ` href="${escHref}"${aAttrs}`
  }
  return `<a${aAttrs}>${escText}</a>`
}

function itemHtml(hostInner: string, href: string, text: string): string {
  const li = hostInner.match(/<li\b([^>]*)>\s*<a\b([^>]*)>[\s\S]*?<\/a>\s*<\/li>/i)
  const escHref = escapeHtmlAttr(href)
  const escText = escapeHtmlText(text)
  if (!li) return `<li><a href="${escHref}">${escText}</a></li>`
  const liAttrs = li[1] ?? ''
  let aAttrs = li[2] ?? ''
  if (/\bhref\s*=/i.test(aAttrs)) {
    aAttrs = aAttrs.replace(/\bhref\s*=\s*(["']).*?\1/i, `href="${escHref}"`)
  } else {
    aAttrs = ` href="${escHref}"${aAttrs}`
  }
  return `<li${liAttrs}><a${aAttrs}>${escText}</a></li>`
}

function listCloseOffset(inner: string): { tag: string; index: number } | null {
  const open = inner.match(/<(ul|ol)\b[^>]*>/i)
  if (!open || open.index == null) return null
  const tag = open[1]!
  const close = findMatchingClose(inner, tag, open.index + open[0].length)
  if (close < 0) return null
  const closeTag = `</${tag}>`
  return { tag, index: close - closeTag.length }
}

function resolvedTargets(targets: RelatedTarget[]): Array<{ href: string; anchor: string }> {
  const out: Array<{ href: string; anchor: string }> = []
  const seen = new Set<string>()
  for (const t of targets.slice(0, MAX_RELATED_TARGETS)) {
    const href = t.href.trim()
    if (!href) continue
    const key = normHref(href)
    if (seen.has(key)) continue
    seen.add(key)
    const anchor =
      cleanRelatedAnchor({
        h1: t.h1,
        title: t.title,
        href,
        stored: t.anchorText,
        anchorText: t.anchorText,
      }) || 'Article'
    out.push({ href, anchor })
  }
  return out
}

export function buildRelatedArticlesHtml(
  targets: RelatedTarget[],
  style = DEFAULT_BLOCK_STYLE,
): string {
  const items = resolvedTargets(targets)
    .map((t) => `<li><a href="${escapeHtmlAttr(t.href)}">${escapeHtmlText(t.anchor)}</a></li>`)
    .join('')
  const styleAttr = style ? ` style="${escapeHtmlAttr(style)}"` : ''
  return `<aside ${RELATED_MARKER}="1"${styleAttr}><h2>Related reading</h2><ul>${items}</ul></aside>`
}

function articleLayoutStyle(html: string): string {
  const open = html.match(/<article\b([^>]*)>/i)
  const style = open?.[1]?.match(/\bstyle\s*=\s*(["'])(.*?)\1/i)?.[2]
  if (style && /max-width|margin/i.test(style)) return style
  return DEFAULT_BLOCK_STYLE
}

function insertNewBlock(html: string, block: string): string {
  if (/<\/article>/i.test(html)) {
    return html.replace(/<\/article>/i, `${block}</article>`)
  }
  if (/<\/main>/i.test(html)) {
    return html.replace(/<\/main>/i, `${block}</main>`)
  }
  if (/<footer\b/i.test(html)) {
    return html.replace(/<footer\b/i, `${block}<footer`)
  }
  return html.replace(/<\/html>/i, `${block}</html>`)
}

function appendToBlock(
  html: string,
  host: RelatedBlock,
  targets: Array<{ href: string; anchor: string }>,
): { html: string; updated: number } {
  const existing = hrefsIn(host.inner)
  const missing = targets.filter((t) => !existing.has(normHref(t.href)))
  let inner = host.inner
  if (missing.length > 0) {
    const asListItems = host.tag === 'ul' || host.tag === 'ol' || Boolean(listCloseOffset(inner))
    const asAnchors =
      !asListItems &&
      (host.tag === 'a-run' || /<a\b/i.test(inner))
    if (asAnchors) {
      const indent = inner.match(/\n([ \t]*)<a\b/i)?.[1] ?? '      '
      const items = missing
        .map((t) => anchorItemHtml(inner, t.href, t.anchor))
        .join(`\n${indent}`)
      const last = [...inner.matchAll(/<\/a>/gi)].pop()
      if (last && last.index != null) {
        const at = last.index + last[0].length
        inner = `${inner.slice(0, at)}\n${indent}${items}${inner.slice(at)}`
      } else {
        inner = `${inner}\n${indent}${items}`
      }
    } else if (host.tag === 'ul' || host.tag === 'ol') {
      const indent = inner.match(/\n([ \t]*)<li/i)?.[1] ?? '    '
      const items = missing.map((t) => itemHtml(inner, t.href, t.anchor)).join(`\n${indent}`)
      inner = `${inner.replace(/\s*$/, '')}\n${indent}${items}\n`
    } else {
      const list = listCloseOffset(inner)
      const indent = inner.match(/\n([ \t]*)<li/i)?.[1] ?? '    '
      const items = missing.map((t) => itemHtml(inner, t.href, t.anchor)).join(`\n${indent}`)
      if (list) {
        const before = inner.slice(0, list.index).replace(/\s*$/, '')
        inner = `${before}\n${indent}${items}\n${indent.slice(0, Math.max(0, indent.length - 2))}</${list.tag}>${inner.slice(list.index + `</${list.tag}>`.length)}`
      } else {
        inner = `${inner}\n<ul>\n    ${items}\n</ul>`
      }
    }
  }

  if (host.tag === 'a-run') {
    let next = `${html.slice(0, host.start)}${inner}${html.slice(host.end)}`
    const extras = findRelatedBlocks(next).filter((b) => b.isSeoranko)
    for (const extra of extras.sort((a, b) => b.start - a.start)) {
      next = `${next.slice(0, extra.start)}${next.slice(extra.end)}`
    }
    const updated = missing.length > 0 || extras.length > 0 ? 1 : 0
    return { html: next, updated }
  }

  const open = html.slice(host.start, html.indexOf('>', host.start) + 1)
  const close = `</${host.tag}>`
  let next = `${html.slice(0, host.start)}${open}${inner}${close}${html.slice(host.end)}`

  const extras = findRelatedBlocks(next).filter(
    (b) => b.isSeoranko && b.start !== host.start,
  )
  if (!host.isSeoranko) {
    for (const extra of extras.sort((a, b) => b.start - a.start)) {
      next = `${next.slice(0, extra.start)}${next.slice(extra.end)}`
    }
  }

  const updated = missing.length > 0 || extras.length > 0 ? 1 : 0
  return { html: next, updated }
}

/**
 * Append related links into an existing related nav/aside/section/div, or into
 * a Related h2/h3/h4 plus its following list. Updates a SEORANKO block in
 * place (idempotent). A new block is never placed after <footer> or directly
 * before </body>.
 */
export function addRelatedArticlesBlock(
  html: string,
  targets: RelatedTarget[],
): { html: string; updated: number } {
  const resolved = resolvedTargets(targets)
  if (resolved.length === 0) return { html, updated: 0 }

  const blocks = findRelatedBlocks(html)
  const headingHosts = findRelatedHeadingHosts(html).filter(
    (h) => !blocks.some((b) => h.start >= b.start && h.end <= b.end),
  )
  const host =
    blocks.find((b) => !b.isSeoranko) || blocks[0] || headingHosts[0]
  if (host) {
    return appendToBlock(html, host, resolved)
  }

  const block = buildRelatedArticlesHtml(targets, articleLayoutStyle(html))
  return { html: insertNewBlock(html, block), updated: 1 }
}

/** Same-folder siblings: share path dirname, exclude self. */
export function pickRelatedSiblingUrls(
  pageUrl: string,
  candidates: Array<{ url: string; title?: string | null; h1?: string | null }>,
  limit = 3,
): RelatedTarget[] {
  let dir: string
  try {
    const u = new URL(pageUrl)
    const parts = u.pathname.replace(/\/+$/, '').split('/')
    parts.pop()
    dir = parts.join('/') || '/'
  } catch {
    return []
  }

  const out: RelatedTarget[] = []
  for (const c of candidates) {
    if (c.url === pageUrl) continue
    try {
      const p = new URL(c.url)
      const parts = p.pathname.replace(/\/+$/, '').split('/')
      parts.pop()
      const cdir = parts.join('/') || '/'
      if (cdir !== dir) continue
      const href = p.pathname + p.search
      out.push({
        href,
        anchorText: cleanRelatedAnchor({
          h1: c.h1,
          title: c.title,
          href,
        }),
        h1: c.h1,
        title: c.title,
      })
      if (out.length >= limit) break
    } catch {
      /* skip */
    }
  }
  return out
}
