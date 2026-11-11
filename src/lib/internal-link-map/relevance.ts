/**
 * Source→target relevance for internal links.
 * Field-weighted TF-IDF over title/H1/headings/main content, site-wide IDF,
 * and intent tags from title/H1/headings only. Deterministic, no paid APIs.
 */

export const RELEVANCE_DROP_THRESHOLD = 0.28
export const RELEVANCE_WEAK_THRESHOLD = 0.45

const STOP = new Set([
  'www',
  'com',
  'html',
  'php',
  'index',
  'page',
  'blog',
  'post',
  'posts',
  'the',
  'and',
  'for',
  'uk',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'this',
  'that',
  'with',
  'from',
  'your',
  'you',
  'how',
  'what',
  'year',
  'guide',
  'guides',
])

const GENERIC_CLUSTERS = new Set([
  'blog',
  'posts',
  'articles',
  'news',
  'resources',
  'guides',
  'pages',
  'site',
])

type IntentRule = { tag: string; terms: string[]; distinctive: string[] }

/**
 * Scoring-only topic tags. Never used as reason labels — reasons come from
 * the strongest shared title/heading terms of the two pages.
 */
const INTENT_RULES: IntentRule[] = [
  {
    tag: 'ev-charging',
    terms: [
      'ev',
      'electric',
      'charger',
      'charging',
      'chargepoint',
      'wallbox',
      'tesla',
      'ccs',
      'supercharger',
    ],
    distinctive: ['ev', 'charger', 'charging', 'chargepoint', 'wallbox', 'tesla', 'ccs', 'supercharger'],
  },
  {
    tag: 'mot-test',
    terms: ['mot', 'retest', 'dvsa', 'motorbike'],
    distinctive: ['mot', 'retest', 'dvsa'],
  },
  {
    tag: 'vehicle-history',
    terms: ['history', 'mileage', 'lookup'],
    distinctive: ['history', 'mileage'],
  },
  {
    tag: 'insurance',
    terms: ['insurance', 'premium'],
    distinctive: ['insurance'],
  },
  {
    tag: 'road-tax',
    terms: ['ved', 'roadtax'],
    distinctive: ['ved', 'roadtax'],
  },
]

export type RelevancePage = {
  url: string
  title: string | null
  h1: string | null
  headings?: string[]
  text: string
  clusterId?: string | null
}

export type RelevanceBand = 'strong' | 'weak' | 'drop'

export type RelevanceScore = {
  score: number
  band: RelevanceBand
  reason: string
  sharedTerms: string[]
  intentTags: string[]
}

export function tokenizeForRelevance(s: string): string[] {
  const out: string[] = []
  for (const part of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length < 2) continue
    if (STOP.has(part)) continue
    out.push(part)
  }
  return out
}

function titleHeadingDocument(page: RelevancePage): string {
  return [page.title, page.h1, ...(page.headings ?? [])].filter(Boolean).join(' ')
}

export function pageDocument(page: RelevancePage): string {
  const title = titleHeadingDocument(page)
  const text = page.text || ''
  return [title, title, title, text].filter(Boolean).join(' ')
}

export function buildIdf(pages: RelevancePage[]): Map<string, number> {
  const df = new Map<string, number>()
  const n = Math.max(1, pages.length)
  for (const p of pages) {
    const seen = new Set(tokenizeForRelevance(pageDocument(p)))
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [term, count] of df) {
    const specificity = n <= 2 ? 1 : 1 - count / n
    idf.set(term, Math.log((1 + n) / (1 + count)) * specificity)
  }
  return idf
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  const vec = new Map<string, number>()
  const len = Math.max(1, tokens.length)
  for (const [term, count] of tf) {
    const weight = (count / len) * (idf.get(term) ?? 0)
    if (weight > 0) vec.set(term, weight)
  }
  return vec
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (const v of a.values()) na += v * v
  for (const v of b.values()) nb += v * v
  const smaller = a.size <= b.size ? a : b
  const larger = smaller === a ? b : a
  for (const [term, weight] of smaller) {
    const other = larger.get(term)
    if (other) dot += weight * other
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (denom === 0) return 0
  return dot / denom
}

function intentTags(tokens: Set<string>): string[] {
  const tags: string[] = []
  for (const rule of INTENT_RULES) {
    let hits = 0
    let distinctive = false
    for (const term of rule.terms) {
      if (!tokens.has(term)) continue
      hits++
      if (rule.distinctive.includes(term)) distinctive = true
    }
    if (distinctive || hits >= 2) tags.push(rule.tag)
  }
  return tags
}

function shortTopic(page: RelevancePage): string {
  const raw = (page.h1 || page.title || '').replace(/\s+/g, ' ').trim()
  if (raw.length >= 8) return raw.length > 48 ? `${raw.slice(0, 45).trim()}…` : raw
  try {
    const path = new URL(page.url).pathname.replace(/\/+$/, '')
    const last = path.split('/').filter(Boolean).pop() || path
    return last.replace(/[-_]+/g, ' ').replace(/\.html$/i, '')
  } catch {
    return page.url
  }
}

function topShared(
  a: string[],
  b: Set<string>,
  idf: Map<string, number>,
  limit = 4,
): string[] {
  const weights = new Map<string, number>()
  for (const t of a) {
    if (!b.has(t)) continue
    const w = idf.get(t) ?? 0
    if (w <= 0) continue
    weights.set(t, (weights.get(t) ?? 0) + w)
  }
  if (weights.size === 0) {
    const fallback = new Map<string, number>()
    for (const t of a) {
      if (!b.has(t)) continue
      fallback.set(t, (fallback.get(t) ?? 0) + 1)
    }
    return [...fallback.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, limit)
      .map(([t]) => t)
  }
  return [...weights.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, limit)
    .map(([t]) => t)
}

function meaningfulCluster(id: string | null | undefined): string | null {
  const c = (id || '').trim().toLowerCase()
  if (!c || GENERIC_CLUSTERS.has(c)) return null
  return c
}

export function relevanceBand(score: number): RelevanceBand {
  if (score < RELEVANCE_DROP_THRESHOLD) return 'drop'
  if (score < RELEVANCE_WEAK_THRESHOLD) return 'weak'
  return 'strong'
}

function reasonFor(input: {
  source: RelevancePage
  target: RelevancePage
  band: RelevanceBand
  sharedTerms: string[]
  cluster: string | null
}): string {
  const shared = input.sharedTerms.slice(0, 3).join(', ')
  if (input.band === 'drop') {
    return `${shortTopic(input.source)} and ${shortTopic(input.target)} are different topics`
  }
  if (input.band === 'strong' && shared) {
    return `Both pages cover ${shared}`
  }
  if (input.band === 'weak') {
    return shared
      ? `Loose overlap on ${shared} — weak match`
      : input.cluster
        ? `Same ${input.cluster} section but different topics — weak match`
        : 'Loose topical overlap — weak match'
  }
  return shared
    ? `Related by shared terms: ${shared}`
    : 'Related pages in the same section'
}

export function scoreLinkRelevance(
  source: RelevancePage,
  target: RelevancePage,
  opts?: { idf?: Map<string, number> },
): RelevanceScore {
  const srcFocus = tokenizeForRelevance(titleHeadingDocument(source))
  const tgtFocus = tokenizeForRelevance(titleHeadingDocument(target))
  const srcTokens = tokenizeForRelevance(pageDocument(source))
  const tgtTokens = tokenizeForRelevance(pageDocument(target))
  const srcFocusSet = new Set(srcFocus)
  const tgtFocusSet = new Set(tgtFocus)
  const idf = opts?.idf ?? buildIdf([source, target])
  const fullCosine = cosine(tfidfVector(srcTokens, idf), tfidfVector(tgtTokens, idf))
  const focusCosine = cosine(tfidfVector(srcFocus, idf), tfidfVector(tgtFocus, idf))
  const srcIntent = intentTags(srcFocusSet)
  const tgtIntent = intentTags(tgtFocusSet)
  const sharedIntent = srcIntent.filter((t) => tgtIntent.includes(t))
  const intentOverlap =
    sharedIntent.length === 0
      ? 0
      : sharedIntent.length / Math.min(srcIntent.length, tgtIntent.length)
  const srcCluster = meaningfulCluster(source.clusterId)
  const tgtCluster = meaningfulCluster(target.clusterId)
  const cluster =
    srcCluster && tgtCluster && srcCluster === tgtCluster ? srcCluster : null

  const clusterScore = cluster ? 0.28 : 0
  const tfidfScore = 0.35 * fullCosine + 0.2 * focusCosine
  const intentScore = sharedIntent.length > 0 ? 0.35 + 0.1 * intentOverlap : 0
  const score = Math.max(0, Math.min(1, clusterScore + tfidfScore + intentScore))
  const band = relevanceBand(score)
  const sharedTerms = topShared(srcFocus, tgtFocusSet, idf)
  const fallbackShared =
    sharedTerms.length > 0 ? sharedTerms : topShared(srcTokens, new Set(tgtTokens), idf)
  return {
    score: Math.round(score * 1000) / 1000,
    band,
    reason: reasonFor({
      source,
      target,
      band,
      sharedTerms: fallbackShared,
      cluster,
    }),
    sharedTerms: fallbackShared,
    intentTags: sharedIntent,
  }
}

export function shouldKeepPlannedLink(
  kind: string,
  band: RelevanceBand,
  opts?: { sourceIsHubOrHome?: boolean },
): boolean {
  if (band !== 'drop') return true
  if (kind === 'sibling') return false
  if (kind === 'depth-shortcut') return Boolean(opts?.sourceIsHubOrHome)
  if (kind === 'orphan-inlink') return Boolean(opts?.sourceIsHubOrHome)
  return true
}
