/**
 * Page-level robots directives (meta + X-Robots-Tag).
 *
 * R3: names and values case-insensitive.
 * R5: comma-separated values.
 * R7: `none` expands to `noindex, nofollow`.
 * R8: meta in <body> is respected.
 */

import { parseHtml } from './html-parser'

export type RobotsDirectiveToken =
  | 'index'
  | 'noindex'
  | 'follow'
  | 'nofollow'
  | 'none'
  | 'noarchive'
  | 'nosnippet'
  | 'noimageindex'
  | 'unavailable_after'
  | string

export type RobotsDirectiveSet = {
  /** Expanded tokens (none → noindex + nofollow). Lowercase. */
  tokens: Set<string>
  /** Raw content string before expansion. */
  raw: string
  source: 'meta-robots' | 'meta-googlebot' | 'x-robots-tag'
}

/**
 * Expand and tokenise a directive content string (R3, R5, R7).
 */
export function expandRobotsDirectives(raw: string): Set<string> {
  const out = new Set<string>()
  for (const part of raw.split(',')) {
    const token = part.trim().toLowerCase()
    if (!token) continue
    // Strip optional value after colon (e.g. unavailable_after: date)
    const name = token.split(':')[0]!.trim()
    if (!name) continue
    if (name === 'none') {
      out.add('noindex')
      out.add('nofollow')
      continue
    }
    out.add(name)
  }
  return out
}

export function setHasNoindex(tokens: Set<string>): boolean {
  return tokens.has('noindex')
}

export function setHasNofollow(tokens: Set<string>): boolean {
  return tokens.has('nofollow')
}

/**
 * Restrictive resolution (R6): noindex beats index, nofollow beats follow.
 */
export function effectiveRobotsTokens(
  sets: Array<Set<string>>,
): Set<string> {
  const merged = new Set<string>()
  for (const s of sets) {
    for (const t of s) merged.add(t)
  }
  if (merged.has('noindex')) merged.delete('index')
  if (merged.has('nofollow')) merged.delete('follow')
  return merged
}

export type PageRobotsDirectives = {
  metaRobots: RobotsDirectiveSet | null
  metaGooglebot: RobotsDirectiveSet | null
  xRobotsTags: RobotsDirectiveSet[]
  /** Combined effective tokens across meta-robots + all X-Robots-Tag (not googlebot). */
  effectiveAllCrawlers: Set<string>
  hasNoindex: boolean
}

/**
 * Collect robots meta (head+body) and X-Robots-Tag header values.
 */
export function extractPageRobotsDirectives(
  headers: Headers,
  body: string,
  contentType: string | null,
): PageRobotsDirectives {
  const xRobotsTags: RobotsDirectiveSet[] = []
  // Headers.get joins duplicates with ", " — also support getSetCookie-style
  // multi via raw get. For multiple X-Robots-Tag, fetch API may coalesce.
  const xRaw = headers.get('x-robots-tag')
  if (xRaw) {
    // Multiple header values may be comma-joined already; treat whole as one
    // set, but also split on commas that separate top-level directives.
    xRobotsTags.push({
      tokens: expandRobotsDirectives(xRaw),
      raw: xRaw,
      source: 'x-robots-tag',
    })
  }

  let metaRobots: RobotsDirectiveSet | null = null
  let metaGooglebot: RobotsDirectiveSet | null = null

  const parseHtmlTree =
    !contentType ||
    /text\/html|application\/xhtml\+xml/i.test(contentType) ||
    looksLikeHtml(body)

  if (parseHtmlTree && body) {
    const parsed = parseHtml(body)
    for (const meta of [
      ...parsed.headElements('meta'),
      ...parsed.bodyElements('meta'),
    ]) {
      const name = (meta.attrs.name ?? meta.attrs.Name ?? '').toLowerCase()
      const content = meta.attrs.content ?? meta.attrs.Content ?? ''
      if (!content) continue
      if (name === 'robots' && !metaRobots) {
        metaRobots = {
          tokens: expandRobotsDirectives(content),
          raw: content,
          source: 'meta-robots',
        }
      }
      if (name === 'googlebot' && !metaGooglebot) {
        metaGooglebot = {
          tokens: expandRobotsDirectives(content),
          raw: content,
          source: 'meta-googlebot',
        }
      }
    }
  }

  const crawlerSets: Array<Set<string>> = []
  if (metaRobots) crawlerSets.push(metaRobots.tokens)
  for (const x of xRobotsTags) crawlerSets.push(x.tokens)
  const effectiveAllCrawlers = effectiveRobotsTokens(crawlerSets)

  return {
    metaRobots,
    metaGooglebot,
    xRobotsTags,
    effectiveAllCrawlers,
    hasNoindex:
      setHasNoindex(effectiveAllCrawlers) ||
      (metaGooglebot != null && setHasNoindex(metaGooglebot.tokens)),
  }
}

function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 256).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}

/** Compare two token sets for equality. */
export function tokenSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const t of a) {
    if (!b.has(t)) return false
  }
  return true
}
