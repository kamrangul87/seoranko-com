// Ensure requested internal links become real clickable <a href> anchors.

import type { InternalLink } from '@/lib/article-master'
import {
  enclosingParagraphHtml,
  isBareDomainRootUrl,
  textContainsFinancialFigure,
} from '@/lib/bare-domain-url'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function alreadyLinked(html: string, url: string): boolean {
  return html.includes(`href="${url}"`) || html.includes(`href='${url}'`) || html.includes(url)
}

function wouldCiteFigureWithHomepage(html: string, matchIndex: number, url: string): boolean {
  if (!isBareDomainRootUrl(url)) return false
  return textContainsFinancialFigure(enclosingParagraphHtml(html, matchIndex))
}

export type InjectedLinkSkip = { url: string; reason: string }

/**
 * If a link URL is missing as an href, inject a real anchor.
 * Prefer wrapping an existing plain-text mention of the anchor text;
 * otherwise append a short linked sentence before Bottom Line / FAQ / end.
 *
 * Bare homepage URLs are never wrapped into a paragraph that already states
 * a financial figure — that created false PARTIAL citations.
 */
export function injectMissingInternalLinks(
  html: string,
  links: InternalLink[],
): {
  html: string
  injected: string[]
  alreadyPresent: string[]
  skipped: InjectedLinkSkip[]
} {
  let result = html
  const injected: string[] = []
  const alreadyPresent: string[] = []
  const skipped: InjectedLinkSkip[] = []

  for (const link of links) {
    if (!link.url || !link.anchorText) continue
    if (alreadyLinked(result, link.url)) {
      alreadyPresent.push(link.url)
      continue
    }

    const anchor = link.anchorText.trim()
    const anchorRe = new RegExp(`\\b(${escapeRegExp(anchor)})\\b`, 'i')
    let wrapped = false
    let searchFrom = 0
    while (!wrapped) {
      const slice = result.slice(searchFrom)
      const match = slice.match(anchorRe)
      if (!match || match.index == null) break
      const absIndex = searchFrom + match.index
      const before = result.slice(Math.max(0, absIndex - 40), absIndex)
      if (/<a\b[^>]*$/i.test(before) || /href=["'][^"']*$/i.test(before)) {
        searchFrom = absIndex + match[0].length
        continue
      }
      if (wouldCiteFigureWithHomepage(result, absIndex, link.url)) {
        searchFrom = absIndex + match[0].length
        continue
      }
      const linked = `<a href="${link.url}" rel="noopener">${match[1]}</a>`
      result = result.slice(0, absIndex) + linked + result.slice(absIndex + match[0].length)
      injected.push(link.url)
      wrapped = true
    }
    if (wrapped) continue

    if (isBareDomainRootUrl(link.url)) {
      // Still allow a Related sentence outside figure copy (before FAQ / schema).
      const insertBefore = result.search(
        /<h2[^>]*>\s*(Bottom Line|FAQ|Frequently Asked Questions|About the Author)/i,
      )
      const schemaIdx = result.search(/<script[^>]*type=["']application\/ld\+json/i)
      const insertAt = insertBefore >= 0 ? insertBefore : schemaIdx
      const nearby =
        insertAt >= 0
          ? enclosingParagraphHtml(result, Math.max(0, insertAt - 1))
          : result.slice(-400)
      if (textContainsFinancialFigure(nearby) && insertAt < 0) {
        skipped.push({
          url: link.url,
          reason:
            'Homepage URL not placed next to financial figures — add a specific page to the link registry',
        })
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

  return { html: result, injected, alreadyPresent, skipped }
}
