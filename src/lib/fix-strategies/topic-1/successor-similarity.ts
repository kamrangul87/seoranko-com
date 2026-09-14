import {
  SUCCESSOR_SIMILARITY_CONFIG,
  type SuccessorSimilarityConfig,
} from './config'

export type LivePage = {
  url: string
  path: string
  /** Raw HTML or already-extracted main text. */
  html: string
}

export type SuccessorCandidate = {
  url: string
  path: string
  pathScore: number
  contentScore: number
  score: number
}

/**
 * Strip tags / scripts and collapse whitespace for content comparison.
 * This is similarity of page bodies — not phrase-matching for "not found".
 */
export function normalizeMainContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pathTokens(path: string): string[] {
  return path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

/** Jaccard similarity over path segments. */
export function pathSimilarity(a: string, b: string): number {
  const ta = new Set(pathTokens(a))
  const tb = new Set(pathTokens(b))
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

/** Token Jaccard over normalised main content. */
export function contentSimilarity(htmlA: string, htmlB: string): number {
  const a = new Set(normalizeMainContent(htmlA).split(' ').filter(Boolean))
  const b = new Set(normalizeMainContent(htmlB).split(' ').filter(Boolean))
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Score live pages as successor candidates for a missing path.
 * `missingContent` is optional historical/cached body; when absent, content
 * score is 0 and only path similarity contributes (still must clear floor
 * via path alone — usually fails, correctly).
 */
export function scoreSuccessors(
  missingPath: string,
  missingContent: string | null,
  livePages: LivePage[],
  config: Partial<SuccessorSimilarityConfig> = {},
): SuccessorCandidate[] {
  const cfg = { ...SUCCESSOR_SIMILARITY_CONFIG, ...config }
  const out: SuccessorCandidate[] = []

  for (const page of livePages) {
    if (page.path === missingPath) continue
    const pathScore = pathSimilarity(missingPath, page.path)
    const contentScore =
      missingContent == null
        ? 0
        : contentSimilarity(missingContent, page.html)
    const score =
      cfg.pathWeight * pathScore + cfg.contentWeight * contentScore
    if (score >= cfg.floor) {
      out.push({
        url: page.url,
        path: page.path,
        pathScore,
        contentScore,
        score,
      })
    }
  }

  return out.sort((a, b) => b.score - a.score)
}
