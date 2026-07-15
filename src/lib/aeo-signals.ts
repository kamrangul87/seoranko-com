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

// --- Entity Coverage Scoring ---
export interface EntityCoverageResult {
  entityCount: number
  entitiesPerThousandWords: number
  topEntities: string[]
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  score: number
  suggestions: string[]
  entityTypes: {
    organisations: number
    people: number
    places: number
    products: number
    concepts: number
  }
}

export function scoreEntityCoverage(articleContent: string): EntityCoverageResult {
  const text = articleContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = text.split(/\s+/).filter(w => w.length > 0)
  const wordCount = words.length

  const orgPattern = /\b(?:Ltd|Limited|Inc|Corp|Corporation|Group|Company|Co\.|PLC|LLP|LLC)\b/g
  const orgs = (text.match(orgPattern) || []).length +
    (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+(?:Ltd|Limited|Inc|Corp|Group|Company)\b/g) || []).length

  const peoplePattern = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sir)\s+[A-Z][a-z]+/g
  const people = (text.match(peoplePattern) || []).length

  const placePattern = /\b(?:UK|United Kingdom|England|Scotland|Wales|London|Manchester|Birmingham|US|USA|United States)\b/g
  const places = (text.match(placePattern) || []).length

  const productPattern = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\b/g
  const allCaps = (text.match(productPattern) || [])
  const products = Math.max(0, allCaps.length - orgs - people - places)

  const conceptPattern = /\b(?:AI|SEO|GEO|AEO|SERP|EV|OZEV|EEAT|JSON-LD|API|CCS|CHAdeMO)\b/g
  const concepts = (text.match(conceptPattern) || []).length

  const entityCount = orgs + people + places + Math.min(products, 15) + concepts
  const entitiesPerThousandWords = wordCount > 0 ? (entityCount / wordCount) * 1000 : 0

  let grade: 'A' | 'B' | 'C' | 'D' | 'F'
  let score: number

  if (entitiesPerThousandWords >= 8) { grade = 'A'; score = 90 + Math.min(10, (entitiesPerThousandWords - 8) * 2) }
  else if (entitiesPerThousandWords >= 6) { grade = 'B'; score = 75 + ((entitiesPerThousandWords - 6) / 2) * 15 }
  else if (entitiesPerThousandWords >= 4) { grade = 'C'; score = 55 + ((entitiesPerThousandWords - 4) / 2) * 20 }
  else if (entitiesPerThousandWords >= 2) { grade = 'D'; score = 30 + ((entitiesPerThousandWords - 2) / 2) * 25 }
  else { grade = 'F'; score = Math.max(0, entitiesPerThousandWords * 15) }

  const suggestions: string[] = []
  if (orgs < 2) suggestions.push('Name specific organisations, companies, or official bodies (e.g. "OZEV" not "the government agency")')
  if (people < 1) suggestions.push('Attribute claims to named experts, researchers, or spokespersons')
  if (places < 1) suggestions.push('Include specific geographic references where relevant')
  if (entitiesPerThousandWords < 6) suggestions.push('Sites with 8+ named entities per 1,000 words see 3× more AI citations (Floyi AIRS 2026 research)')

  const entityMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || []
  const entityFreq: Record<string, number> = {}
  for (const e of entityMatches) entityFreq[e] = (entityFreq[e] || 0) + 1
  const topEntities = Object.entries(entityFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([entity]) => entity)

  return {
    entityCount,
    entitiesPerThousandWords: Math.round(entitiesPerThousandWords * 10) / 10,
    topEntities,
    grade,
    score: Math.round(Math.min(100, score)),
    suggestions,
    entityTypes: { organisations: orgs, people, places, products: Math.min(products, 15), concepts }
  }
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
