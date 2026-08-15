// Ensure requested internal links become real clickable <a href> anchors.

import type { InternalLink } from '@/lib/article-master'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function alreadyLinked(html: string, url: string): boolean {
  return html.includes(`href="${url}"`) || html.includes(`href='${url}'`) || html.includes(url)
}

/**
 * If a link URL is missing as an href, inject a real anchor.
 * Prefer wrapping an existing plain-text mention of the anchor text;
 * otherwise append a short linked sentence before Bottom Line / FAQ / end.
 */
export function injectMissingInternalLinks(
  html: string,
  links: InternalLink[]
): { html: string; injected: string[]; alreadyPresent: string[] } {
  let result = html
  const injected: string[] = []
  const alreadyPresent: string[] = []

  for (const link of links) {
    if (!link.url || !link.anchorText) continue
    if (alreadyLinked(result, link.url)) {
      alreadyPresent.push(link.url)
      continue
    }

    const anchor = link.anchorText.trim()
    const anchorRe = new RegExp(`\\b(${escapeRegExp(anchor)})\\b`, 'i')
    const match = result.match(anchorRe)

    if (match && match.index != null) {
      // Skip if this occurrence is already inside an <a> tag
      const before = result.slice(Math.max(0, match.index - 40), match.index)
      if (!/<a\b[^>]*$/i.test(before) && !/href=["'][^"']*$/i.test(before)) {
        const linked = `<a href="${link.url}" rel="noopener">${match[1]}</a>`
        result = result.slice(0, match.index) + linked + result.slice(match.index + match[0].length)
        injected.push(link.url)
        continue
      }
    }

    const contextBit = link.context
      ? ` — ${link.context.replace(/<[^>]+>/g, '').slice(0, 80)}`
      : ''
    const sentence =
      `<p>Related: <a href="${link.url}" rel="noopener">${anchor}</a>${contextBit}.</p>\n`

    const insertBefore = result.search(/<h2[^>]*>\s*(Bottom Line|FAQ|Frequently Asked Questions|About the Author)/i)
    if (insertBefore >= 0) {
      result = result.slice(0, insertBefore) + sentence + result.slice(insertBefore)
    } else {
      const schemaIdx = result.search(/<script[^>]*type=["']application\/ld\+json/i)
      if (schemaIdx >= 0) {
        result = result.slice(0, schemaIdx) + sentence + result.slice(schemaIdx)
      } else {
        result += '\n' + sentence
      }
    }
    injected.push(link.url)
  }

  return { html: result, injected, alreadyPresent }
}
