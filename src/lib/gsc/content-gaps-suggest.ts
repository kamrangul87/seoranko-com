import { analyzeSerpGap } from '@/lib/serp-gap-analyzer'

export type ContentGapItem = {
  gap: string
  servesQueries: string[]
}

export type ContentGapsBrief = {
  basis: 'serp' | 'queries-only'
  gaps: ContentGapItem[]
  notes: string[]
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(Boolean),
  )
}

function includesAllTokens(haystack: Set<string>, phrase: string): boolean {
  const q = tokens(phrase)
  if (q.size === 0) return false
  let present = 0
  for (const t of q) {
    if (haystack.has(t)) present++
  }
  // consider it covered when a majority of tokens are present
  return present >= Math.max(1, Math.ceil(q.size * 0.6))
}

function detectYearFreshness(queries: string[], pageText: string): ContentGapItem | null {
  const m = queries.join(' ').match(/\b(20\d{2})\b/)
  if (!m) return null
  const year = m[1]
  const lower = pageText.toLowerCase()
  if (!lower.includes(year) && !/\bupdated\s*(on|:)?\s*\w+/i.test(lower)) {
    return {
      gap: `Add current-year context (e.g., ${year}) and an updated date if appropriate`,
      servesQueries: queries.filter((q) => q.includes(year)),
    }
  }
  return null
}

function detectPricingNeed(queries: string[], pageText: string): ContentGapItem | null {
  const needsPrice = queries.some((q) => /\b(price|prices|cost|fee|fees)\b/i.test(q))
  if (!needsPrice) return null
  if (!/(price|cost|fee|£|\$|€)/i.test(pageText)) {
    return {
      gap: 'State current pricing/cost/fees clearly (no invented numbers)',
      servesQueries: queries.filter((q) => /\b(price|prices|cost|fee|fees)\b/i.test(q)),
    }
  }
  return null
}

function detectQuestions(queries: string[], pageText: string): ContentGapItem | null {
  const questionWords = /\b(what|how|why|when|where|who|can|does|do|is|are|should)\b/i
  const needsQA = queries.some((q) => questionWords.test(q) || /\?$/.test(q.trim()))
  if (!needsQA) return null
  if (!/\?/.test(pageText)) {
    return {
      gap: 'Answer common questions explicitly (add a short FAQ or Q&A section)',
      servesQueries: queries.filter((q) => questionWords.test(q) || /\?$/.test(q.trim())),
    }
  }
  return null
}

export async function buildContentGapsBrief(input: {
  url: string
  html: string
  queries: string[]
  market?: string
}): Promise<ContentGapsBrief> {
  const market = input.market || 'Global'
  const pageText = stripTags(input.html || '')
  const pageTokens = tokens(pageText)
  const topQueries = input.queries.slice(0, 3)

  // Try SERP-based gap analysis first (best-effort; returns empty on failure).
  let gaps: ContentGapItem[] = []
  let basis: ContentGapsBrief['basis'] = 'queries-only'
  try {
    const serp = await analyzeSerpGap(topQueries[0] || '', market)
    if (serp && (serp.contentGaps.length || serp.commonTopics.length)) {
      basis = 'serp'
      const candidates = [
        ...serp.contentGaps.slice(0, 8),
        ...serp.commonTopics.slice(0, 6),
      ]
      for (const c of candidates) {
        if (!c) continue
        if (includesAllTokens(pageTokens, c)) continue
        gaps.push({
          gap: c,
          servesQueries: topQueries.filter((q) => includesAllTokens(tokens(q), c) || includesAllTokens(tokens(c), q)),
        })
        if (gaps.length >= 8) break
      }
    }
  } catch {
    // fall back to queries-only
  }

  // Heuristic gaps based on queries + page content (apply in both modes to enrich).
  const heuristic: ContentGapItem[] = []
  const yr = detectYearFreshness(topQueries, pageText)
  if (yr) heuristic.push(yr)
  const pr = detectPricingNeed(topQueries, pageText)
  if (pr) heuristic.push(pr)
  const qa = detectQuestions(topQueries, pageText)
  if (qa) heuristic.push(qa)

  // De-duplicate by gap text
  const all = [...gaps, ...heuristic]
  const dedup = new Map<string, ContentGapItem>()
  for (const g of all) {
    if (!g.gap) continue
    const key = g.gap.toLowerCase()
    if (!dedup.has(key)) dedup.set(key, g)
    else {
      const merged = dedup.get(key)!
      const qs = new Set<string>([...merged.servesQueries, ...g.servesQueries])
      dedup.set(key, { ...merged, servesQueries: Array.from(qs) })
    }
  }

  const notes: string[] =
    basis === 'serp'
      ? ['Based on top-ranking results and your page content; never invents facts.']
      : ['Based on your page content and its top queries only (competitor fetch unavailable).']

  return {
    basis,
    gaps: Array.from(dedup.values()).slice(0, 10),
    notes,
  }
}

