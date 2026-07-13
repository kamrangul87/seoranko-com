// src/lib/geo-auditor.ts
// GEO Site Auditor — 8-signal AI readiness score
// Based on: Princeton KDD 2024, AutoGEO ICLR 2026, ai-seo-auditor repo patterns
// Proper JSON-LD lifts LLM extraction accuracy from 16% to 54% (Semrush)
// Named authors cited 2.3x more in AI responses

export interface GEOAuditSignal {
  id: string
  name: string
  score: number          // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  status: 'pass' | 'warn' | 'fail'
  weight: number         // weight in composite score
  finding: string        // what was found
  fix: string            // exact fix to apply
  effort: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high' | 'critical'
}

export interface GEOAuditResult {
  url: string
  auditedAt: string
  compositeScore: number   // 0–100 weighted composite
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  signals: GEOAuditSignal[]
  topFixes: string[]       // ordered by impact × ease
  estimatedCitabilityGain: string
  rawHtml?: string
}

// --- Signal 1: AI Bot Access ---
async function checkAIBotAccess(domain: string): Promise<GEOAuditSignal> {
  const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'GoogleOther', 'Google-Extended', 'cohere-ai', 'FacebookBot']
  let robotsContent = ''
  let robotsFound = false

  try {
    const res = await fetch(`${domain}/robots.txt`, { signal: AbortSignal.timeout(10000) })
    if (res.ok) {
      robotsContent = await res.text()
      robotsFound = true
    }
  } catch { /* robots.txt not found */ }

  if (!robotsFound) {
    return {
      id: 'ai-bot-access', name: 'AI Bot Access', score: 70, grade: 'C', status: 'warn', weight: 15,
      finding: 'No robots.txt found — AI bots are allowed by default but file is missing',
      fix: 'Add a robots.txt with explicit Allow rules for all AI crawlers (GPTBot, PerplexityBot, ClaudeBot, GoogleOther)',
      effort: 'low', impact: 'high'
    }
  }

  const lines = robotsContent.toLowerCase().split('\n').map(l => l.trim())
  const hasWildcardDisallow = lines.some(l => l === 'disallow: /')
  const blockedBots = AI_BOTS.filter(bot => {
    const uaIdx = lines.findIndex(l => l === `user-agent: ${bot.toLowerCase()}`)
    if (uaIdx === -1) return hasWildcardDisallow
    const nextUA = lines.findIndex((l, i) => i > uaIdx && l.startsWith('user-agent:'))
    const block = lines.slice(uaIdx + 1, nextUA === -1 ? lines.length : nextUA)
    return block.some(l => l === 'disallow: /' || l === 'disallow: /*') && !block.some(l => l === 'allow: /')
  })

  const score = blockedBots.length === 0 ? 100 : Math.max(0, 100 - (blockedBots.length / AI_BOTS.length) * 100)
  return {
    id: 'ai-bot-access', name: 'AI Bot Access', score: Math.round(score),
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F',
    status: blockedBots.length === 0 ? 'pass' : 'fail', weight: 15,
    finding: blockedBots.length === 0
      ? 'All major AI crawlers have access'
      : `${blockedBots.length} AI bots blocked: ${blockedBots.join(', ')}`,
    fix: blockedBots.length === 0
      ? 'No action needed'
      : `Add these user-agents to robots.txt with Allow: /\n${blockedBots.map(b => `User-agent: ${b}`).join('\n')}\nAllow: /`,
    effort: 'low', impact: 'critical'
  }
}

// --- Signal 2: llms.txt presence ---
async function checkLLMsTxt(domain: string): Promise<GEOAuditSignal> {
  const checks = await Promise.allSettled([
    fetch(`${domain}/llms.txt`, { method: 'HEAD', signal: AbortSignal.timeout(8000) }),
    fetch(`${domain}/llms-full.txt`, { method: 'HEAD', signal: AbortSignal.timeout(8000) }),
    fetch(`${domain}/.well-known/ai.json`, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
  ])

  const hasLLMs = checks[0].status === 'fulfilled' && (checks[0].value as Response).ok
  const hasLLMsFull = checks[1].status === 'fulfilled' && (checks[1].value as Response).ok
  const hasAIJson = checks[2].status === 'fulfilled' && (checks[2].value as Response).ok

  const score = hasLLMs && hasAIJson ? 100 : hasLLMs && hasLLMsFull ? 85 : hasLLMs ? 60 : 0
  return {
    id: 'llms-txt', name: 'llms.txt & AI Discovery', score,
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score > 0 ? 'D' : 'F',
    status: hasLLMs ? 'pass' : 'fail', weight: 12,
    finding: hasLLMs
      ? `llms.txt found${hasLLMsFull ? ' + llms-full.txt' : ''}${hasAIJson ? ' + ai.json' : ''}`
      : 'No llms.txt found — AI engines cannot find a curated index of your content',
    fix: hasLLMs ? 'Consider adding llms-full.txt and /.well-known/ai.json for full coverage' : 'Generate and upload llms.txt to your domain root using SEORANKO Settings → llms.txt Manager',
    effort: 'low', impact: 'high'
  }
}

// --- Signal 3: Schema markup completeness ---
async function checkSchemaMarkup(html: string): Promise<GEOAuditSignal> {
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const schemas: Record<string, unknown>[] = []
  let m
  while ((m = scriptPattern.exec(html)) !== null) {
    try { schemas.push(JSON.parse(m[1])) } catch { /* invalid JSON */ }
  }

  const types = schemas.map(s => s['@type'] as string).filter(Boolean)
  const hasArticle = types.some(t => ['Article', 'BlogPosting', 'NewsArticle'].includes(t))
  const hasFAQ = types.some(t => t === 'FAQPage')
  const hasBreadcrumb = types.some(t => t === 'BreadcrumbList')
  const hasOrg = types.some(t => t === 'Organization')
  const hasPerson = types.some(t => t === 'Person')

  const signals = [hasArticle, hasFAQ, hasBreadcrumb, hasOrg, hasPerson]
  const score = Math.round((signals.filter(Boolean).length / signals.length) * 100)

  const missing = [
    !hasArticle && 'Article schema',
    !hasFAQ && 'FAQPage schema',
    !hasBreadcrumb && 'BreadcrumbList schema',
    !hasOrg && 'Organization schema',
    !hasPerson && 'Person/author schema'
  ].filter(Boolean) as string[]

  return {
    id: 'schema-markup', name: 'Schema Markup', score,
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F',
    status: score >= 80 ? 'pass' : score >= 40 ? 'warn' : 'fail', weight: 18,
    finding: schemas.length === 0
      ? 'No JSON-LD schema found — proper schema lifts LLM extraction accuracy from 16% to 54%'
      : `Found: ${types.join(', ')}${missing.length > 0 ? ` | Missing: ${missing.join(', ')}` : ''}`,
    fix: missing.length === 0
      ? 'Schema is comprehensive'
      : `Add missing schema types: ${missing.join(', ')}. Use SEORANKO to generate and inject these automatically.`,
    effort: 'medium', impact: 'critical'
  }
}

// --- Signal 4: Named author / EEAT signals ---
async function checkAuthorSignals(html: string): Promise<GEOAuditSignal> {
  const hasAuthorSchema = /"@type"\s*:\s*"Person"/.test(html)
  const hasAuthorByline = /\b(written by|author:|by )\s*<[^>]+>[^<]+<\/[^>]+>/i.test(html) ||
    /class=["'][^"']*author[^"']*["']/i.test(html)
  const hasAuthorBio = /\b(about the author|author bio)\b/i.test(html)
  const hasDatePublished = /datePublished|date-published|published[:\s]+\d{4}/i.test(html)
  const hasLastUpdated = /last updated|dateModified|date-modified/i.test(html)

  const signals = [hasAuthorSchema, hasAuthorByline, hasAuthorBio, hasDatePublished, hasLastUpdated]
  const score = Math.round((signals.filter(Boolean).length / signals.length) * 100)

  return {
    id: 'author-eeat', name: 'Author & EEAT Signals', score,
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F',
    status: score >= 80 ? 'pass' : score >= 40 ? 'warn' : 'fail', weight: 15,
    finding: `Author schema: ${hasAuthorSchema ? '✓' : '✗'} | Byline: ${hasAuthorByline ? '✓' : '✗'} | Bio: ${hasAuthorBio ? '✓' : '✗'} | Date: ${hasDatePublished ? '✓' : '✗'} | Last updated: ${hasLastUpdated ? '✓' : '✗'}`,
    fix: score >= 90 ? 'EEAT signals are strong' : 'Add named author byline, author bio section, Person schema, published date, and last-updated date. Named authors are cited 2.3× more in AI responses.',
    effort: 'medium', impact: 'high'
  }
}

// --- Signal 5: Content freshness ---
async function checkContentFreshness(html: string): Promise<GEOAuditSignal> {
  const datePatterns = [
    /"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/,
    /"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/,
    /published[:\s]+(\w+ \d+,? \d{4})/i,
    /last updated[:\s]+(\w+ \d+,? \d{4})/i,
    /<time[^>]*datetime=["'](\d{4}-\d{2}-\d{2})/i
  ]

  let latestDate: Date | null = null
  for (const pattern of datePatterns) {
    const match = html.match(pattern)
    if (match) {
      const d = new Date(match[1])
      if (!isNaN(d.getTime()) && (!latestDate || d > latestDate)) latestDate = d
    }
  }

  if (!latestDate) {
    return {
      id: 'content-freshness', name: 'Content Freshness', score: 30, grade: 'D', status: 'warn', weight: 10,
      finding: 'No publish date detected — AI engines cannot assess content freshness',
      fix: 'Add datePublished and dateModified to Article schema. Add visible "Last updated: [date]" text near the article title.',
      effort: 'low', impact: 'medium'
    }
  }

  const days = Math.floor((Date.now() - latestDate.getTime()) / 86400000)
  const score = days < 90 ? 100 : days < 180 ? 80 : days < 365 ? 55 : days < 730 ? 30 : 10
  const label = days < 90 ? 'Fresh' : days < 180 ? 'Aging' : days < 365 ? 'Stale' : 'Very stale'

  return {
    id: 'content-freshness', name: 'Content Freshness', score,
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F',
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail', weight: 10,
    finding: `${label} — last updated ${days} days ago (${latestDate.toLocaleDateString('en-GB')})`,
    fix: days < 90 ? 'Content is fresh — maintain regular updates' : `Content is ${label.toLowerCase()}. Update key stats, refresh the date, and re-submit to Google Search Console. Content under 90 days is 3× more likely to be cited by AI engines.`,
    effort: days < 365 ? 'low' : 'medium', impact: days < 180 ? 'low' : 'high'
  }
}

// --- Signal 6: Fact density ---
async function checkFactDensity(html: string): Promise<GEOAuditSignal> {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = text.split(' ').filter(w => w.length > 0)
  const wordCount = words.length

  const stats = (text.match(/\b\d+(\.\d+)?(%|percent|x|×|times)\b/gi) || []).length
  const citations = (text.match(/\b(according to|research (shows|found)|study by|reported by|per |data from)\b/gi) || []).length
  const namedEntities = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g) || []).length
  const dates = (text.match(/\b(19|20)\d{2}\b/g) || []).length

  const facts = stats + citations + Math.min(namedEntities, 15) + dates
  const density = wordCount > 0 ? (facts / wordCount) * 100 : 0
  const score = density >= 2 ? 100 : density >= 1.5 ? 85 : density >= 1 ? 65 : density >= 0.5 ? 40 : 20

  return {
    id: 'fact-density', name: 'Fact Density', score: Math.round(score),
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F',
    status: score >= 65 ? 'pass' : score >= 40 ? 'warn' : 'fail', weight: 12,
    finding: `${density.toFixed(1)} facts per 100 words | ${stats} statistics, ${citations} citations, ${dates} dates | ${wordCount} words total`,
    fix: density >= 1.5 ? 'Fact density is strong' : 'Add more specific statistics, named sources, and verifiable dates. Target 1.5+ verifiable facts per 100 words for optimal AI citation likelihood.',
    effort: 'medium', impact: 'high'
  }
}

// --- Signal 7: Question heading structure ---
async function checkQuestionHeadings(html: string): Promise<GEOAuditSignal> {
  const h2Pattern = /<h2[^>]*>([\s\S]*?)<\/h2>/gi
  const h2s: string[] = []
  let m
  while ((m = h2Pattern.exec(html)) !== null) {
    h2s.push(m[1].replace(/<[^>]+>/g, '').trim())
  }

  const questionWords = /^(how|what|why|when|where|which|who|is|are|can|does|do|should|will)/i
  const questionH2s = h2s.filter(h => questionWords.test(h) || h.endsWith('?'))
  const ratio = h2s.length > 0 ? questionH2s.length / h2s.length : 0
  const score = h2s.length === 0 ? 20 : Math.round(ratio * 100)

  return {
    id: 'question-headings', name: 'Question Headings', score,
    grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F',
    status: score >= 60 ? 'pass' : score >= 30 ? 'warn' : 'fail', weight: 8,
    finding: h2s.length === 0
      ? 'No H2 headings found'
      : `${questionH2s.length} of ${h2s.length} H2 headings are question-format (${Math.round(ratio * 100)}%)`,
    fix: ratio >= 0.6 ? 'Question heading ratio is strong' : `Convert more H2 headings into questions. Question-format headings match AI query patterns directly. Current: "${h2s[0] || ''}" → Better: "What ${h2s[0] || 'Is This Topic'}?"`,
    effort: 'low', impact: 'medium'
  }
}

// --- Signal 8: Authority external links ---
async function checkAuthorityLinks(html: string): Promise<GEOAuditSignal> {
  const hrefPattern = /href=["'](https?:\/\/[^"']+)["']/gi
  const links: string[] = []
  let m
  while ((m = hrefPattern.exec(html)) !== null) links.push(m[1])

  const govLinks = links.filter(l => l.includes('.gov') || l.includes('.gov.uk')).length
  const eduLinks = links.filter(l => l.includes('.edu') || l.includes('.ac.uk')).length
  const orgLinks = links.filter(l => /\.(org)(\/|$)/.test(l) && !l.includes('wikipedia')).length
  const wikiLinks = links.filter(l => l.includes('wikipedia.org')).length
  const total = govLinks + eduLinks + orgLinks + wikiLinks

  const score = total >= 4 ? 100 : total >= 3 ? 85 : total >= 2 ? 65 : total >= 1 ? 40 : 10

  return {
    id: 'authority-links', name: 'Authority External Links', score,
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F',
    status: total >= 2 ? 'pass' : total >= 1 ? 'warn' : 'fail', weight: 10,
    finding: `${total} authority links: ${govLinks} .gov, ${eduLinks} .edu/.ac.uk, ${orgLinks} .org, ${wikiLinks} Wikipedia`,
    fix: total >= 3 ? 'Authority link profile is strong' : 'Add links to .gov.uk, academic sources (.ac.uk), or official regulatory bodies. AI engines use external authority links as a trust signal when deciding which sources to cite.',
    effort: 'medium', impact: 'medium'
  }
}

// --- Composite scorer ---
function computeComposite(signals: GEOAuditSignal[]): number {
  const total = signals.reduce((sum, s) => sum + s.weight, 0)
  const weighted = signals.reduce((sum, s) => sum + (s.score * s.weight), 0)
  return Math.round(weighted / total)
}

function getTopFixes(signals: GEOAuditSignal[]): string[] {
  const impactOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
  const effortOrder: Record<string, number> = { low: 3, medium: 2, high: 1 }

  return signals
    .filter(s => s.status !== 'pass')
    .sort((a, b) => {
      const aScore = impactOrder[a.impact] * effortOrder[a.effort]
      const bScore = impactOrder[b.impact] * effortOrder[b.effort]
      return bScore - aScore
    })
    .slice(0, 5)
    .map(s => `[${s.name}] ${s.fix}`)
}

// --- Main audit function ---
export async function runGEOAudit(url: string): Promise<GEOAuditResult> {
  const cleanUrl = url.startsWith('http') ? url : `https://${url}`
  const domain = new URL(cleanUrl).origin

  let html = ''
  try {
    const res = await fetch(cleanUrl, {
      headers: { 'User-Agent': 'SEORANKO-GEO-Auditor/1.0' },
      signal: AbortSignal.timeout(20000)
    })
    html = await res.text()
  } catch (err) {
    throw new Error(`Could not fetch ${cleanUrl}: ${String(err)}`)
  }

  const [botAccess, llmsTxt, schema, author, freshness, facts, headings, authority] = await Promise.all([
    checkAIBotAccess(domain),
    checkLLMsTxt(domain),
    checkSchemaMarkup(html),
    checkAuthorSignals(html),
    checkContentFreshness(html),
    checkFactDensity(html),
    checkQuestionHeadings(html),
    checkAuthorityLinks(html)
  ])

  const signals = [botAccess, llmsTxt, schema, author, freshness, facts, headings, authority]
  const compositeScore = computeComposite(signals)

  return {
    url: cleanUrl,
    auditedAt: new Date().toISOString(),
    compositeScore,
    grade: compositeScore >= 90 ? 'A' : compositeScore >= 75 ? 'B' : compositeScore >= 55 ? 'C' : compositeScore >= 35 ? 'D' : 'F',
    signals,
    topFixes: getTopFixes(signals),
    estimatedCitabilityGain: compositeScore < 50
      ? 'Fixing critical issues could increase AI citation likelihood by 3–5×'
      : compositeScore < 75
        ? 'Addressing remaining gaps could increase AI citations by 1.5–2×'
        : 'Site is well-optimised for AI citation',
    rawHtml: undefined
  }
}
