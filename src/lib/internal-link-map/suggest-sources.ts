/**
 * Deterministic "pages that should link here" — path-token overlap, plus
 * cached Page-2 / GSC sources when present. No paid APIs, no live fetch.
 */

import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import type {
  LinkMapEdge,
  LinkMapNode,
  LinkSourceSuggestion,
  Page2LinkCache,
} from './types'
import { isUtilityPage } from './utility-page'

const STOP = new Set([
  'www',
  'com',
  'html',
  'php',
  'index',
  'page',
  'blog',
  'post',
  'posts',
])

function norm(url: string): string {
  return normalizeFixStrategyUrl(url) ?? url
}

function tokens(url: string): Set<string> {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    /* keep */
  }
  const out = new Set<string>()
  for (const part of path.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length < 2) continue
    if (STOP.has(part)) continue
    out.add(part)
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

function defaultAnchor(targetUrl: string): string {
  try {
    const seg =
      new URL(targetUrl).pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() ||
      'page'
    return seg.replace(/[-_]+/g, ' ')
  } catch {
    return 'page'
  }
}

export function suggestLinkSources(input: {
  targetUrl: string
  nodes: LinkMapNode[]
  edges: LinkMapEdge[]
  page2?: Page2LinkCache | null
  max?: number
}): LinkSourceSuggestion[] {
  const max = input.max ?? 5
  const target = norm(input.targetUrl)
  if (isUtilityPage({ url: target })) return []
  const already = new Set<string>()
  for (const e of input.edges) {
    if (norm(e.target) === target) already.add(norm(e.source))
  }

  const out: LinkSourceSuggestion[] = []
  const seen = new Set<string>()

  const push = (s: LinkSourceSuggestion) => {
    const key = norm(s.sourceUrl)
    if (seen.has(key) || key === target || already.has(key)) return
    if (isUtilityPage({ url: key })) return
    seen.add(key)
    out.push({ ...s, sourceUrl: key, targetUrl: target })
  }

  if (input.page2) {
    for (const s of input.page2.sources) {
      push({
        sourceUrl: s.sourceUrl,
        targetUrl: target,
        anchorText: input.page2.anchorText || defaultAnchor(target),
        reason: 'Cached from Search Console (Page 2)',
        insertion: s.insertion,
      })
    }
  }

  const targetTokens = tokens(target)
  const ranked = input.nodes
    .map((n) => ({ node: n, url: norm(n.url), score: jaccard(targetTokens, tokens(n.url)) }))
    .filter((r) => r.url !== target && !already.has(r.url) && !seen.has(r.url))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.url.localeCompare(b.url)
    })

  for (const r of ranked) {
    if (out.length >= max) break
    push({
      sourceUrl: r.url,
      targetUrl: target,
      anchorText: defaultAnchor(target),
      reason:
        r.score > 0 ? 'Topic overlap in the URL path' : 'Related page on this site',
      insertion: 'related-list',
    })
  }

  return out.slice(0, max)
}
