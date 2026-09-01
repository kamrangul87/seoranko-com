/**
 * Minimal robots.txt parser — mechanical rule matching for crawl/index diagnosis.
 * Returns the literal rule line that matched a URL path.
 */

export interface RobotsRule {
  agent: string
  type: 'allow' | 'disallow'
  path: string
  line: string
}

export interface RobotsMatch {
  allowed: boolean
  ruleLine: string | null
  evidence: string
}

function parseRobotsTxt(text: string): RobotsRule[] {
  const rules: RobotsRule[] = []
  let currentAgents: string[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue

    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (key === 'user-agent') {
      currentAgents = [value.toLowerCase()]
      continue
    }

    if (key === 'disallow' || key === 'allow') {
      for (const agent of currentAgents) {
        rules.push({
          agent,
          type: key as 'allow' | 'disallow',
          path: value,
          line: raw.trim(),
        })
      }
    }
  }

  return rules
}

function pathMatchesRule(path: string, rulePath: string): boolean {
  if (rulePath === '') return false
  if (rulePath === '/') return true
  return path.startsWith(rulePath)
}

function matchAgentRules(rules: RobotsRule[], path: string, agent: string): RobotsMatch {
  const relevant = rules.filter((r) => r.agent === agent || r.agent === '*')
  if (relevant.length === 0) {
    return { allowed: true, ruleLine: null, evidence: `No robots.txt rules for User-agent: ${agent} — default allow` }
  }

  // Longest matching rule wins (Google-style)
  let best: RobotsRule | null = null
  for (const rule of relevant) {
    if (!pathMatchesRule(path, rule.path)) continue
    if (!best || rule.path.length > best.path.length) best = rule
  }

  if (!best) {
    return { allowed: true, ruleLine: null, evidence: `No Disallow/Allow rule matched path ${path}` }
  }

  const allowed = best.type === 'allow'
  return {
    allowed,
    ruleLine: best.line,
    evidence: allowed
      ? `Allow rule matched: "${best.line}" for path ${path}`
      : `Disallow rule matched: "${best.line}" for path ${path}`,
  }
}

/** Evaluate whether *bot* may fetch *url* per robots.txt body. */
export function matchRobotsForUrl(robotsTxt: string, url: string, bot = '*'): RobotsMatch {
  if (!robotsTxt.trim()) {
    return { allowed: true, ruleLine: null, evidence: 'robots.txt empty or missing — default allow' }
  }

  let path = '/'
  try {
    path = new URL(url).pathname || '/'
  } catch {
    return { allowed: true, ruleLine: null, evidence: `Invalid URL for robots match: ${url}` }
  }

  const rules = parseRobotsTxt(robotsTxt)
  const specific = matchAgentRules(rules, path, bot.toLowerCase())
  if (bot !== '*') return specific
  return specific
}

export function extractSitemapUrlsFromRobots(robotsTxt: string): string[] {
  return robotsTxt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^sitemap:/i.test(l))
    .map((l) => l.replace(/^sitemap:\s*/i, '').trim())
    .filter(Boolean)
}
