// src/lib/robots-checker.ts
// Checks whether a site's robots.txt blocks AI crawlers

export interface AIBot {
  name: string
  userAgent: string
  owner: string
  description: string
}

export const AI_BOTS: AIBot[] = [
  { name: 'ChatGPT', userAgent: 'GPTBot', owner: 'OpenAI', description: 'Used by ChatGPT to train and retrieve content' },
  { name: 'ChatGPT browsing', userAgent: 'ChatGPT-User', owner: 'OpenAI', description: 'Used when ChatGPT browses the web in real-time' },
  { name: 'Perplexity', userAgent: 'PerplexityBot', owner: 'Perplexity AI', description: 'Perplexity AI search and citations' },
  { name: 'Claude', userAgent: 'ClaudeBot', owner: 'Anthropic', description: 'Used by Claude to retrieve web content' },
  { name: 'Google AI', userAgent: 'GoogleOther', owner: 'Google', description: 'Google AI Overviews and Gemini content retrieval' },
  { name: 'Gemini', userAgent: 'Google-Extended', owner: 'Google', description: 'Used to train Google Gemini models' },
  { name: 'Cohere', userAgent: 'cohere-ai', owner: 'Cohere', description: 'Cohere AI content retrieval' },
  { name: 'Meta AI', userAgent: 'FacebookBot', owner: 'Meta', description: 'Meta AI and Llama content retrieval' },
]

export interface BotCheckResult {
  bot: AIBot
  status: 'allowed' | 'blocked' | 'unknown'
  reason: string
}

export interface RobotsCheckResult {
  domain: string
  robotsTxtFound: boolean
  results: BotCheckResult[]
  allAllowed: boolean
  blockedCount: number
  recommendedAddition: string
}

export function generateAIBotsRobotsBlock(): string {
  const userAgents = AI_BOTS.map(bot => `User-agent: ${bot.userAgent}`).join('\n')
  return `# Allow AI search engines and LLM crawlers
# These bots enable your content to appear in ChatGPT, Perplexity, Claude, and Google AI Overviews
${userAgents}
Allow: /

# Standard crawlers
User-agent: *
Allow: /
`
}

export function parseRobotsForAIBots(robotsContent: string, domain: string): RobotsCheckResult {
  const lines = robotsContent.split('\n').map(l => l.trim().toLowerCase())
  const results: BotCheckResult[] = []

  const hasWildcardDisallow = lines.some(l => l === 'disallow: /')

  for (const bot of AI_BOTS) {
    const uaLower = bot.userAgent.toLowerCase()
    const uaIndex = lines.findIndex(l => l === `user-agent: ${uaLower}`)

    if (hasWildcardDisallow && uaIndex === -1) {
      results.push({
        bot,
        status: 'blocked',
        reason: `Wildcard "Disallow: /" blocks all bots including ${bot.userAgent}`
      })
      continue
    }

    if (uaIndex === -1) {
      results.push({ bot, status: 'unknown', reason: `${bot.userAgent} not explicitly mentioned — likely allowed by default` })
      continue
    }

    const nextUAIndex = lines.findIndex((l, i) => i > uaIndex && l.startsWith('user-agent:'))
    const blockEnd = nextUAIndex === -1 ? lines.length : nextUAIndex
    const blockLines = lines.slice(uaIndex + 1, blockEnd)

    const isDisallowed = blockLines.some(l => l === 'disallow: /' || l === 'disallow: /*')
    const isAllowed = blockLines.some(l => l === 'allow: /' || l === 'allow: /*')

    if (isDisallowed && !isAllowed) {
      results.push({ bot, status: 'blocked', reason: `${bot.userAgent} explicitly blocked with Disallow: /` })
    } else {
      results.push({ bot, status: 'allowed', reason: `${bot.userAgent} is allowed` })
    }
  }

  const blockedCount = results.filter(r => r.status === 'blocked').length

  return {
    domain,
    robotsTxtFound: true,
    results,
    allAllowed: blockedCount === 0,
    blockedCount,
    recommendedAddition: generateAIBotsRobotsBlock()
  }
}
