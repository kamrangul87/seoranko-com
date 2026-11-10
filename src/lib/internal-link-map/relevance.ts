/**
 * Source→target relevance for internal links.
 * TF-IDF cosine over stored title/H1/headings/text, cluster match, and
 * same-intent tags. Deterministic, no paid APIs.
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

type IntentRule = { tag: string; label: string; terms: string[]; distinctive: string[] }

const INTENT_RULES: IntentRule[] = [
  {
    tag: 'ev-charging',
    label: 'EV charging',
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
      'motorway',
    ],
    distinctive: ['ev', 'charger', 'charging', 'chargepoint', 'wallbox', 'tesla', 'ccs', 'supercharger'],
  },
  {
    tag: 'mot-test',
    label: 'MOT tests',
    terms: ['mot', 'retest', 'dvsa', 'motorbike'],
    distinctive: ['mot', 'retest', 'dvsa'],
  },
  {
    tag: 'vehicle-history',
    label: 'vehicle history checks',
    terms: ['history', 'mileage', 'lookup'],
    distinctive: ['history', 'mileage'],
  },
  {
    tag: 'insurance',
    label: 'car insurance',
    terms: ['insurance', 'premium'],
    distinctive: ['insurance'],
  },
  {
    tag: 'road-tax',
    label: 'road tax',
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

export function pageDocument(page: RelevancePage): string {
  return [page.title, page.h1, ...(page.headings ?? []), page.text]
    .filter(Boolean)
    .join(' ')
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
    idf.set(term, Math.log((1 + n) / (1 + count)) + 1)
  }
  return idf
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  const vec = new Map<string, number>()
  const len = Math.max(1, tokens.length)
  for (const [term, count] of tf) {
    vec.set(term, (count / len) * (idf.get(term) ?? 1))
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

function intentLabel(tag: string): string {
  return INTENT_RULES.find((r) => r.tag === tag)?.label ?? tag
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

function topShared(a: string[], b: Set<string>, limit = 4): string[] {
  const counts = new Map<string, number>()
  for (const t of a) {
    if (!b.has(t)) continue
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()]
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
  sharedIntent: string[]
  cluster: string | null
}): string {
  const shared = input.sharedTerms.slice(0, 3).join(', ')
  if (input.band === 'drop') {
    return `${shortTopic(input.source)} and ${shortTopic(input.target)} are different topics`
  }
  if (input.sharedIntent.length > 0) {
    const label = intentLabel(input.sharedIntent[0]!)
    return shared
      ? `Both pages cover ${label} (${shared})`
      : `Both pages cover ${label}`
  }
  if (input.band === 'strong' && shared) {
    return `Related by shared heading terms: ${shared}`
  }
  if (input.band === 'weak') {
    return shared
      ? `Loose overlap on ${shared} — weak match`
      : input.cluster
        ? `Same ${input.cluster} section but different topics — weak match`
        : 'Loose topical overlap — weak match'
  }
  return shared
    ? `Shared heading terms: ${shared}`
    : 'Related pages in the same section'
}

export function scoreLinkRelevance(
  source: RelevancePage,
  target: RelevancePage,
  opts?: { idf?: Map<string, number> },
): RelevanceScore {
  const srcTokens = tokenizeForRelevance(pageDocument(source))
  const tgtTokens = tokenizeForRelevance(pageDocument(target))
  const srcSet = new Set(srcTokens)
  const tgtSet = new Set(tgtTokens)
  const idf = opts?.idf ?? buildIdf([source, target])
  const cosineSim = cosine(tfidfVector(srcTokens, idf), tfidfVector(tgtTokens, idf))
  const srcIntent = intentTags(srcSet)
  const tgtIntent = intentTags(tgtSet)
  const sharedIntent = srcIntent.filter((t) => tgtIntent.includes(t))
  const unionIntent = new Set([...srcIntent, ...tgtIntent])
  const intentJaccard =
    unionIntent.size === 0 ? 0 : sharedIntent.length / unionIntent.size
  const srcCluster = meaningfulCluster(source.clusterId)
  const tgtCluster = meaningfulCluster(target.clusterId)
  const cluster =
    srcCluster && tgtCluster && srcCluster === tgtCluster ? srcCluster : null

  const clusterScore = cluster ? 0.3 : 0
  const tfidfScore = 0.45 * cosineSim
  const intentScore =
    sharedIntent.length > 0 ? 0.35 + 0.1 * intentJaccard : 0
  const score = Math.max(0, Math.min(1, clusterScore + tfidfScore + intentScore))
  const band = relevanceBand(score)
  const sharedTerms = topShared(srcTokens, tgtSet)
  return {
    score: Math.round(score * 1000) / 1000,
    band,
    reason: reasonFor({
      source,
      target,
      band,
      sharedTerms,
      sharedIntent,
      cluster,
    }),
    sharedTerms,
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
  if (kind === 'orphan-inlink') return Boolean(opts?.sourceIsHubOrHome)
  return true
}
