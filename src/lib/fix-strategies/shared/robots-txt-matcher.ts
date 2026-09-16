/** Googlebot processes at most 500 KiB of robots.txt (RFC 9309 / Google docs). */
export const ROBOTS_TXT_MAX_BYTES = 500 * 1024

type RobotsRule = {
  type: 'allow' | 'disallow'
  pattern: string
}

type RobotsGroup = {
  agents: string[]
  rules: RobotsRule[]
}

function truncateRobotsBody(body: string): string {
  if (body.length <= ROBOTS_TXT_MAX_BYTES) return body
  return body.slice(0, ROBOTS_TXT_MAX_BYTES)
}

function stripInlineComment(line: string): string {
  const hash = line.indexOf('#')
  if (hash < 0) return line
  return line.slice(0, hash)
}

/**
 * Parse robots.txt into groups. Lines before the first user-agent are ignored
 * for Allow/Disallow (RFC 9309 §2.2.2).
 */
export function parseRobotsTxt(robotsTxt: string): RobotsGroup[] {
  const text = truncateRobotsBody(robotsTxt)
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let expectingAgents = false

  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = stripInlineComment(rawLine).trim()
    if (!line) continue

    const colon = line.indexOf(':')
    if (colon < 0) continue

    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (key === 'user-agent') {
      const agent = value
      if (!agent) continue
      if (!current || !expectingAgents) {
        current = { agents: [agent], rules: [] }
        groups.push(current)
        expectingAgents = true
      } else {
        current.agents.push(agent)
      }
      continue
    }

    if (key === 'allow' || key === 'disallow') {
      if (!current) continue // rules before first UA are ignored
      expectingAgents = false
      current.rules.push({ type: key, pattern: value })
      continue
    }

    // Other records (e.g. Sitemap) must not terminate a group.
    if (current) expectingAgents = false
  }

  return groups
}

function agentMatches(agentToken: string, userAgent: string): boolean {
  return agentToken.toLowerCase() === userAgent.toLowerCase()
}

function selectRules(groups: RobotsGroup[], userAgent: string): RobotsRule[] {
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== '*' && agentMatches(a, userAgent)),
  )
  if (specific.length > 0) {
    return specific.flatMap((g) => g.rules)
  }

  const star = groups.filter((g) => g.agents.some((a) => a === '*'))
  return star.flatMap((g) => g.rules)
}

/**
 * Match a robots.txt path pattern against a path (case-sensitive).
 * Supports `*` (any run of characters) and `$` (end anchor).
 */
export function robotsPathMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false

  let endAnchored = false
  let body = pattern
  if (body.endsWith('$')) {
    endAnchored = true
    body = body.slice(0, -1)
  }

  let regex = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (ch === '*') {
      regex += '.*'
    } else if (/[.+?^${}()|[\]\\]/.test(ch)) {
      regex += `\\${ch}`
    } else {
      regex += ch
    }
  }

  const re = new RegExp(`^${regex}${endAnchored ? '$' : ''}`)
  return re.test(path)
}

export type PathAllowedResult = {
  allowed: boolean
  matchedRule: string | null
}

/**
 * RFC 9309 / Google robots.txt path matcher.
 *
 * - Truncates body at 500 KiB
 * - User-agent group selection is case-insensitive (`*` fallback)
 * - Path match is case-sensitive; supports `*` and `$`
 * - Longest matching rule wins; equal length prefers Allow over Disallow
 * - No match → allowed
 */
export function isPathAllowed(
  robotsTxt: string,
  userAgent: string,
  path: string,
): PathAllowedResult {
  const groups = parseRobotsTxt(robotsTxt)
  const rules = selectRules(groups, userAgent)

  let best: RobotsRule | null = null
  for (const rule of rules) {
    // Empty Disallow/Allow pattern does not match any path.
    if (!robotsPathMatches(rule.pattern, path)) continue

    if (!best) {
      best = rule
      continue
    }

    if (rule.pattern.length > best.pattern.length) {
      best = rule
      continue
    }

    if (
      rule.pattern.length === best.pattern.length &&
      rule.type === 'allow' &&
      best.type === 'disallow'
    ) {
      // Equal length: Prefer Allow over Disallow.
      best = rule
    }
  }

  if (!best) {
    return { allowed: true, matchedRule: null }
  }

  const matchedRule = `${best.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.pattern}`
  return {
    allowed: best.type === 'allow',
    matchedRule,
  }
}
