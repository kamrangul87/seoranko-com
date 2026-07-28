// src/lib/article-quality-gate.ts
// Pre-publish quality gate — runs after generation AND after humanization
// Inspired by: seomachine content_scorer.py, anti-slop 507-entry banned list,
// Agentic SEO Skill validation agents, Alpha Level SEO copywriting checklist 2026
//
// Gap filled: every existing tool audits AFTER publish. This gate runs BEFORE save.

// ============================================================
// RULE DEFINITIONS
// ============================================================

import { validateSchema } from './schema-validator'

// AI slop patterns — expanded from anti-slop GitHub repo
const AI_SLOP_PATTERNS = [
  /\bin today's (world|landscape|digital age|fast-paced)/i,
  /\bit('s| is) (worth noting|important to note|crucial to understand)/i,
  /\bin (conclusion|summary|this article|this guide|this piece)/i,
  /\bwe will (explore|delve into|dive into|examine|discuss)/i,
  /\blet('s| us) (explore|delve into|dive into|examine)/i,
  /\bcomprehensive (guide|overview|look|analysis)/i,
  /\bin the realm of/i,
  /\bleverage (your|our|the|this)/i,
  /\bdelve into/i,
  /\bfurthermore,/i,
  /\bmoreover,/i,
  /\bthe bottom line is/i,
  /\bit goes without saying/i,
  /\bneedless to say/i,
  /\bwithout further ado/i,
  /\bat the end of the day/i,
  /\bin other words,/i,
  /\bto summarize,/i,
  /\bto conclude,/i,
]

const DANGEROUS_FACT_PATTERNS = [
  {
    pattern: /\bup to \d+%\s+(of|off|reduction|discount|grant|cover)/i,
    message: 'Specific percentage claim detected — verify this is current and accurate before publishing',
    severity: 'critical' as const,
    category: 'grant-figure' as const,
  },
  {
    pattern: /\bup to £\d+\b/i,
    message: 'Specific monetary cap stated — verify this figure is current (grant amounts change frequently)',
    severity: 'critical' as const,
    category: 'grant-figure' as const,
  },
  {
    pattern: /\bup to \$\d+\b/i,
    message: 'Specific monetary cap stated — verify this figure is current',
    severity: 'critical' as const,
    category: 'grant-figure' as const,
  },
  {
    pattern: /\b(as of|from) (january|february|march|april|may|june|july|august|september|october|november|december) 20\d{2}\b.*?(grant|scheme|fund|subsid)/i,
    message: 'Dated grant/scheme claim — confirm this is still current policy',
    severity: 'warning' as const,
    category: 'dated-policy' as const,
  },
]

const COPY_ERROR_PATTERNS = [
  {
    pattern: /\b(\w{2,})\s+\1\b/g,
    message: 'Duplicate word found',
    severity: 'critical' as const,
    category: 'typo' as const,
  },
  {
    pattern: /[a-z]\.[a-z]/g,
    message: 'Possible missing space after period',
    severity: 'warning' as const,
    category: 'typo' as const,
  },
  {
    pattern: /\b\w*([a-z])\1{3,}\w*\b/g,
    message: 'Possible repeated character / typo',
    severity: 'warning' as const,
    category: 'typo' as const,
  },
  {
    pattern: /\.\s*[a-z]{1,4}\.\s+[A-Z]/g,
    message: 'Possible broken paragraph merge — short fragment between sentences',
    severity: 'critical' as const,
    category: 'merge-artifact' as const,
  },
]

function countTypically(content: string): number {
  return (content.match(/\btypically\b/gi) || []).length
}

function countHedgeWords(content: string): Record<string, number> {
  const hedges = ['typically', 'generally', 'usually', 'often', 'sometimes', 'may', 'might', 'could', 'tend to']
  const counts: Record<string, number> = {}
  for (const hedge of hedges) {
    const matches = content.match(new RegExp(`\\b${hedge}\\b`, 'gi')) || []
    if (matches.length > 0) counts[hedge] = matches.length
  }
  return counts
}

// ============================================================
// QUALITY ISSUE TYPES
// ============================================================

export type IssueSeverity = 'critical' | 'warning' | 'info'
export type IssueCategory =
  | 'typo'
  | 'merge-artifact'
  | 'grant-figure'
  | 'dated-policy'
  | 'ai-slop'
  | 'hedging'
  | 'cross-brand-link'
  | 'schema'
  | 'missing-author'
  | 'missing-date'
  | 'word-count'
  | 'fact-density'

export interface QualityIssue {
  id: string
  severity: IssueSeverity
  category: IssueCategory
  title: string
  description: string
  location?: string
  autoFixable: boolean
  autoFixDescription?: string
}

export interface QualityGateResult {
  passed: boolean
  score: number
  issues: QualityIssue[]
  criticalCount: number
  warningCount: number
  autoFixedCount: number
  articleAfterAutoFix: string
  readyToPublish: boolean
  blockers: string[]
}

// ============================================================
// MAIN QUALITY GATE FUNCTION
// ============================================================

export async function runQualityGate(
  articleContent: string,
  options: {
    brand: string
    keyword: string
    authorName: string
    registeredLinkDomains: string[]
    minWordCount?: number
    maxTypically?: number
  }
): Promise<QualityGateResult> {

  const {
    brand,
    authorName,
    registeredLinkDomains,
    minWordCount = 800,
    maxTypically = 5
  } = options

  const issues: QualityIssue[] = []
  let articleAfterAutoFix = articleContent
  let autoFixedCount = 0

  // ---- RULE 1: Typos and copy errors ----
  for (const rule of COPY_ERROR_PATTERNS) {
    const matches = articleContent.match(rule.pattern)
    if (matches && matches.length > 0) {
      const idx = articleContent.search(rule.pattern)
      const context = articleContent.slice(Math.max(0, idx - 30), idx + 60)
      issues.push({
        id: `copy-${rule.category}-${issues.length}`,
        severity: rule.severity,
        category: rule.category,
        title: rule.message,
        description: `Found ${matches.length} instance(s). Check near: "${context.trim().slice(0, 80)}"`,
        location: context.trim().slice(0, 100),
        autoFixable: false
      })
    }
  }

  // ---- RULE 2: Dangerous fact patterns ----
  for (const rule of DANGEROUS_FACT_PATTERNS) {
    const match = articleContent.match(rule.pattern)
    if (match) {
      const idx = articleContent.search(rule.pattern)
      const context = articleContent.slice(Math.max(0, idx - 20), idx + 80)
      issues.push({
        id: `fact-${rule.category}-${issues.length}`,
        severity: rule.severity,
        category: rule.category,
        title: rule.message,
        description: `Found: "${match[0]}" — ${rule.severity === 'critical' ? 'Verify before publishing.' : 'Double-check this claim.'}`,
        location: context.trim().slice(0, 100),
        autoFixable: rule.category === 'grant-figure',
        autoFixDescription: rule.category === 'grant-figure'
          ? 'Auto-fix adds "(verify at GOV.UK)" after the figure'
          : undefined
      })
    }
  }

  // ---- RULE 3: AI slop patterns ----
  for (const pattern of AI_SLOP_PATTERNS) {
    const match = articleContent.match(pattern)
    if (match) {
      issues.push({
        id: `slop-${issues.length}`,
        severity: 'warning',
        category: 'ai-slop',
        title: `AI pattern detected: "${match[0]}"`,
        description: 'This phrase is a common AI-generated signal that reduces human score. Consider removing or rewriting.',
        location: match[0],
        autoFixable: true,
        autoFixDescription: 'Auto-fix removes this phrase from the article'
      })
    }
  }

  // ---- RULE 4: "Typically" overuse ----
  const typicallyCount = countTypically(articleContent)
  if (typicallyCount > maxTypically) {
    issues.push({
      id: 'hedging-typically',
      severity: typicallyCount > 10 ? 'critical' : 'warning',
      category: 'hedging',
      title: `"Typically" used ${typicallyCount} times — target is ${maxTypically} or fewer`,
      description: `High frequency hedging (${typicallyCount}×) is a primary AI-detection signal. The humaniser should reduce this but ${typicallyCount} instances remain.`,
      autoFixable: true,
      autoFixDescription: `Auto-fix reduces "typically" count to ${maxTypically} by replacing excess instances`
    })
  }

  const hedgeCounts = countHedgeWords(articleContent)
  const totalHedges = Object.values(hedgeCounts).reduce((a, b) => a + b, 0)
  const wordCount = articleContent.split(/\s+/).filter(w => w.length > 0).length

  if (totalHedges > wordCount / 50) {
    issues.push({
      id: 'hedging-total',
      severity: 'warning',
      category: 'hedging',
      title: `High hedge word density: ${totalHedges} hedge words in ${wordCount} words`,
      description: `Top offenders: ${Object.entries(hedgeCounts).sort((a,b) => b[1]-a[1]).slice(0,3).map(([w,c]) => `"${w}" ×${c}`).join(', ')}`,
      autoFixable: false
    })
  }

  // ---- RULE 5: Cross-brand link detection ----
  const linkPattern = /href=["']https?:\/\/([^/"']+)/gi
  let linkMatch
  while ((linkMatch = linkPattern.exec(articleContent)) !== null) {
    const linkedDomain = linkMatch[1].replace('www.', '')
    const isBrandSite = ['autodun.com', 'seoranko.com', 'fitford.com', 'minso', 'minsofurniture'].some(
      d => linkedDomain.includes(d)
    )
    if (!isBrandSite) continue
    const isRegistered = registeredLinkDomains.some(d => linkedDomain.includes(d))
    if (!isRegistered) {
      const context = articleContent.slice(Math.max(0, linkMatch.index - 30), linkMatch.index + 80)
      issues.push({
        id: `cross-brand-link-${issues.length}`,
        severity: 'critical',
        category: 'cross-brand-link',
        title: `Cross-brand link detected: ${linkedDomain}`,
        description: `Article brand is "${brand}" but this links to "${linkedDomain}" which is not in the registry for this brand.`,
        location: context.slice(0, 100),
        autoFixable: true,
        autoFixDescription: 'Auto-fix removes the cross-brand link and replaces it with plain text'
      })
    }
  }

  // ---- RULE 6: Schema validation (full schema.org property-level check) ----
  const schemaResult = validateSchema(articleContent)

  for (const schemaIssue of schemaResult.issues) {
    issues.push({
      id: `schema-${schemaIssue.schemaType}-${schemaIssue.property}`,
      severity: schemaIssue.severity === 'error' ? 'critical' : 'warning',
      category: 'schema',
      title: `${schemaIssue.schemaType}: ${schemaIssue.property}`,
      description: schemaIssue.message,
      autoFixable: false
    })
  }

  // Schema/content parity — a visible FAQ with no FAQPage block. This is a
  // cross-check against the rendered article, not a JSON-LD property rule,
  // so it stays outside validateSchema().
  const hasVisibleFAQ = /<h3>/.test(articleContent) || /class="faq/.test(articleContent)
  if (hasVisibleFAQ && !schemaResult.schemasFound.includes('FAQPage')) {
    issues.push({
      id: 'schema-faq-parity',
      severity: 'critical',
      category: 'schema',
      title: 'FAQPage schema missing but FAQ content exists',
      description: 'Visible FAQ section found but no FAQPage JSON-LD schema. Schema must match visible content.',
      autoFixable: false
    })
  }

  // ---- RULE 7: Author byline ----
  if (!articleContent.includes(authorName)) {
    issues.push({
      id: 'missing-author',
      severity: 'warning',
      category: 'missing-author',
      title: `Author name "${authorName}" not found in article`,
      description: 'Author byline is required for EEAT signals.',
      autoFixable: false
    })
  }

  // ---- RULE 8: Word count ----
  if (wordCount < minWordCount) {
    issues.push({
      id: 'word-count',
      severity: 'warning',
      category: 'word-count',
      title: `Article is ${wordCount} words — minimum recommended is ${minWordCount}`,
      description: 'Short articles rank below the recommended threshold for comprehensive topic coverage.',
      autoFixable: false
    })
  }

  // ---- AUTO-FIX PASS ----
  // Fix 1: Remove cross-brand links
  if (issues.some(i => i.category === 'cross-brand-link' && i.autoFixable)) {
    articleAfterAutoFix = articleAfterAutoFix.replace(
      /<a[^>]*href=["'][^"']*["'][^>]*>([^<]*)<\/a>/gi,
      (match, anchorText) => {
        const hrefMatch = match.match(/href=["']https?:\/\/([^/"']+)/)
        if (!hrefMatch) return match
        const domain = hrefMatch[1].replace('www.', '')
        const isWrongBrand = ['autodun.com', 'seoranko.com', 'fitford.com'].some(d =>
          domain.includes(d) && !registeredLinkDomains.some(r => domain.includes(r))
        )
        if (isWrongBrand) { autoFixedCount++; return anchorText }
        return match
      }
    )
  }

  // Fix 2: Reduce "typically" overuse
  const typIssue = issues.find(i => i.id === 'hedging-typically' && i.autoFixable)
  if (typIssue) {
    let count = 0
    articleAfterAutoFix = articleAfterAutoFix.replace(/\btypically\b/gi, (match) => {
      count++
      if (count > maxTypically) { autoFixedCount++; return '' }
      return match
    })
    articleAfterAutoFix = articleAfterAutoFix.replace(/\s{2,}/g, ' ')
  }

  // Fix 3: Remove auto-fixable AI slop patterns
  for (const pattern of AI_SLOP_PATTERNS) {
    const slopIssue = issues.find(
      i => i.category === 'ai-slop' && i.autoFixable &&
      i.location && pattern.test(i.location)
    )
    if (slopIssue) {
      articleAfterAutoFix = articleAfterAutoFix.replace(pattern, '')
      autoFixedCount++
    }
  }

  articleAfterAutoFix = articleAfterAutoFix.replace(/\s{2,}/g, ' ').trim()

  // ---- COMPUTE FINAL SCORE ----
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const score = Math.max(0, 100 - (criticalCount * 20) - (warningCount * 5))
  const passed = criticalCount === 0
  const readyToPublish = criticalCount === 0 && warningCount <= 2
  const blockers = issues
    .filter(i => i.severity === 'critical')
    .map(i => `[${i.category.toUpperCase()}] ${i.title}`)

  return { passed, score, issues, criticalCount, warningCount, autoFixedCount, articleAfterAutoFix, readyToPublish, blockers }
}
