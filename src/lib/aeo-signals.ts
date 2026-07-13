// Shared AEO/GEO signal library — used by Articles, NLP Analyser, Site Audit, Ranking Agent
// Based on: Princeton KDD 2024, AutoGEO ICLR 2026, ai-seo-auditor repo patterns

export interface ContentFreshnessResult {
  status: 'fresh' | 'aging' | 'stale' | 'very-stale'
  label: string
  daysSincePublish: number
  color: string
  aeoImpact: string
}

export interface HeadingAuditResult {
  totalH2: number
  questionH2: number
  questionRatio: number
  grade: 'A' | 'B' | 'C' | 'F'
  issues: string[]
  hasSkippedLevels: boolean
  hasSingleH1: boolean
}

export interface AuthorityLinkResult {
  govLinks: number
  eduLinks: number
  orgLinks: number
  totalAuthorityLinks: number
  weakAnchorTexts: string[]
  grade: 'A' | 'B' | 'C' | 'F'
  suggestions: string[]
}

export interface LLMsTextResult {
  exists: boolean
  url: string
  entryCount: number
  hasFullVersion: boolean
  hasAIJson: boolean
  grade: 'A' | 'B' | 'C' | 'F'
}

// --- Content Freshness ---
export function scoreContentFreshness(publishDate: string | Date): ContentFreshnessResult {
  const pub = new Date(publishDate)
  const now = new Date()
  const days = Math.floor((now.getTime() - pub.getTime()) / (1000 * 60 * 60 * 24))

  // Content under 3 months old is 3x more likely to be cited by AI (Kevin Indig 2026)
  if (days < 90) return {
    status: 'fresh', label: 'Fresh', daysSincePublish: days, color: '#1D9E75',
    aeoImpact: '3× more likely to be cited by AI engines'
  }
  if (days < 365) return {
    status: 'aging', label: 'Aging', daysSincePublish: days, color: '#BA7517',
    aeoImpact: 'Consider updating key stats and dates'
  }
  if (days < 730) return {
    status: 'stale', label: 'Stale', daysSincePublish: days, color: '#E24B4A',
    aeoImpact: 'AI citation likelihood significantly reduced — refresh recommended'
  }
  return {
    status: 'very-stale', label: 'Very stale', daysSincePublish: days, color: '#A32D2D',
    aeoImpact: 'Critical: AI engines deprioritise content over 2 years old'
  }
}

// --- Heading Structure Audit ---
export function auditHeadingStructure(articleContent: string): HeadingAuditResult {
  const h1Matches = articleContent.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) || []
  const h2Matches = articleContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []
  const h3Matches = articleContent.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi) || []

  // Markdown fallback
  const mdH1 = articleContent.match(/^# .+/gm) || []
  const mdH2 = articleContent.match(/^## .+/gm) || []

  const totalH1 = h1Matches.length + mdH1.length
  const h2List = [...h2Matches, ...mdH2]
  const totalH2 = h2List.length

  // Count question-format H2s
  const questionWords = /^(how|what|why|when|where|which|who|is|are|can|does|do|should|will|would)/i
  const questionH2 = h2List.filter(h => {
    const text = h.replace(/<[^>]+>/g, '').replace(/^##?\s*/, '').trim()
    return questionWords.test(text) || text.endsWith('?')
  }).length

  const questionRatio = totalH2 > 0 ? questionH2 / totalH2 : 0

  const issues: string[] = []
  if (totalH1 !== 1) issues.push(totalH1 === 0 ? 'Missing H1 tag' : 'Multiple H1 tags found — use only one')
  if (questionRatio < 0.5 && totalH2 >= 3) issues.push(`Only ${questionH2} of ${totalH2} H2s are questions — aim for 4+ question-format headings`)
  if (totalH2 < 3) issues.push('Too few H2 headings — add more section structure')

  // Check for skipped heading levels (H1 → H3 without H2)
  const hasSkippedLevels = h3Matches.length > 0 && h2Matches.length === 0

  let grade: 'A' | 'B' | 'C' | 'F'
  if (questionRatio >= 0.67 && totalH1 === 1 && !hasSkippedLevels) grade = 'A'
  else if (questionRatio >= 0.5 && totalH1 === 1) grade = 'B'
  else if (questionRatio >= 0.33) grade = 'C'
  else grade = 'F'

  return { totalH2, questionH2, questionRatio, grade, issues, hasSkippedLevels, hasSingleH1: totalH1 === 1 }
}

// --- Authority Link Audit ---
export function auditAuthorityLinks(articleContent: string): AuthorityLinkResult {
  const hrefPattern = /href=["'](https?:\/\/[^"']+)["']/gi
  const anchorPattern = /<a[^>]*href=["'][^"']*["'][^>]*>([^<]*)<\/a>/gi
  const links: string[] = []
  const anchors: string[] = []
  let m

  while ((m = hrefPattern.exec(articleContent)) !== null) links.push(m[1])
  while ((m = anchorPattern.exec(articleContent)) !== null) anchors.push(m[1].trim())

  const govLinks = links.filter(l => l.includes('.gov') || l.includes('.gov.uk')).length
  const eduLinks = links.filter(l => l.includes('.edu') || l.includes('.ac.uk')).length
  const orgLinks = links.filter(l => l.includes('.org') && !l.includes('wikipedia')).length
  const totalAuthorityLinks = govLinks + eduLinks + orgLinks

  // Flag weak anchor text
  const weakAnchors = ['click here', 'here', 'read more', 'link', 'this', 'this page', 'more info']
  const weakAnchorTexts = anchors.filter(a => weakAnchors.includes(a.toLowerCase()))

  const suggestions: string[] = []
  if (totalAuthorityLinks < 2) suggestions.push('Add at least 2 links to .gov, .ac.uk, or authoritative .org sources')
  if (govLinks === 0 && articleContent.toLowerCase().includes('regulation')) suggestions.push('Article mentions regulations — link to the official gov.uk source')
  if (weakAnchorTexts.length > 0) suggestions.push(`Replace weak anchor text: ${weakAnchorTexts.join(', ')}`)

  let grade: 'A' | 'B' | 'C' | 'F'
  if (totalAuthorityLinks >= 3 && weakAnchorTexts.length === 0) grade = 'A'
  else if (totalAuthorityLinks >= 2) grade = 'B'
  else if (totalAuthorityLinks >= 1) grade = 'C'
  else grade = 'F'

  return { govLinks, eduLinks, orgLinks, totalAuthorityLinks, weakAnchorTexts, grade, suggestions }
}

// --- llms.txt entry generator for one article ---
export function generateLLMsEntry(article: {
  title: string
  url: string
  description: string
  keyword: string
  publishDate: string
  wordCount: number
}): string {
  return `## ${article.title}
URL: ${article.url}
Description: ${article.description}
Primary keyword: ${article.keyword}
Published: ${article.publishDate}
Word count: ${article.wordCount}
`
}

// --- ai.json discovery file generator ---
export function generateAIJson(org: {
  name: string
  url: string
  description: string
  contactEmail?: string
  sameAs: string[]
}): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": org.name,
    "url": org.url,
    "description": org.description,
    ...(org.contactEmail ? { "email": org.contactEmail } : {}),
    "sameAs": org.sameAs.filter(Boolean),
    "ai_crawl_instructions": {
      "allow": true,
      "preferred_format": "markdown",
      "llms_txt": `${org.url.replace(/\/$/, '')}/llms.txt`,
      "llms_full_txt": `${org.url.replace(/\/$/, '')}/llms-full.txt`
    }
  }, null, 2)
}
