/**
 * Findings crawl identity + robots politeness.
 *
 * Product decision (launch 1.3): UA must be SEORANKOBot/1.0 with a public
 * contact URL at /bot explaining the crawler and how to block it.
 */

/** Identifies SEORANKO crawls; contact URL for operators. */
export const SEORANKO_CRAWLER_USER_AGENT =
  'SEORANKOBot/1.0 (+https://seoranko.com/bot)'

export const SEORANKO_CRAWLER_HEADERS: HeadersInit = {
  'User-Agent': SEORANKO_CRAWLER_USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

export type RobotsRules = {
  /** Path prefixes disallowed for our user-agent (longest matching group). */
  disallows: string[]
  allows: string[]
}

/**
 * Parse robots.txt for SEORANKOBot / * groups.
 * Only Disallow/Allow directives are considered (Sitemap handled elsewhere).
 */
export function parseRobotsForCrawler(robotsText: string): RobotsRules {
  const lines = robotsText.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim())
  const groups: Array<{ agents: string[]; disallows: string[]; allows: string[] }> = []
  let current: { agents: string[]; disallows: string[]; allows: string[] } | null =
    null

  for (const line of lines) {
    if (!line) continue
    const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const val = m[2]!.trim()
    if (key === 'user-agent') {
      if (!current || current.disallows.length > 0 || current.allows.length > 0) {
        current = { agents: [val.toLowerCase()], disallows: [], allows: [] }
        groups.push(current)
      } else {
        current.agents.push(val.toLowerCase())
      }
    } else if (current) {
      if (key === 'disallow') current.disallows.push(val)
      else current.allows.push(val)
    }
  }

  const ua = SEORANKO_CRAWLER_USER_AGENT.toLowerCase()
  const specific = groups.find((g) =>
    g.agents.some(
      (a) =>
        a !== '*' &&
        (ua.includes(a) || a.includes('seorankobot') || a.includes('seoranko')),
    ),
  )
  const star = groups.find((g) => g.agents.includes('*'))
  const chosen = specific ?? star
  if (!chosen) return { disallows: [], allows: [] }
  return {
    disallows: chosen.disallows.filter((d) => d.length > 0),
    allows: chosen.allows.filter((a) => a.length > 0),
  }
}

/** True when robots.txt forbids fetching this URL path for our crawler. */
export function isDisallowedByRobots(url: string, rules: RobotsRules): boolean {
  let path: string
  try {
    path = new URL(url).pathname || '/'
  } catch {
    return true
  }

  const matches = (pattern: string) => {
    if (pattern === '') return false
    if (pattern === '/') return true
    return path === pattern || path.startsWith(pattern)
  }

  const allowHit = rules.allows.filter(matches).sort((a, b) => b.length - a.length)[0]
  const disallowHit = rules.disallows
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0]

  if (!disallowHit) return false
  if (allowHit && allowHit.length >= disallowHit.length) return false
  return true
}
