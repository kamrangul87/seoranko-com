/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/publish-safeguards.ts
// Phase H — content-policy safeguards. RANKO's multi-platform auto-publish
// connector, combined with Phase A-D making real publishing actually work,
// puts SEORANKO squarely in the risk profile Google's scaled-content-abuse
// policy targets: a client's whole domain can get suppressed for
// high-volume unreviewed AI content, regardless of whether a human or AI
// wrote it. These checks run before an article can be approved for
// publish — see article-publisher.ts's approveArticleForPublish.
//
// Near-duplicate detection is a hard block ("flag near-duplicate/templated
// output before it can publish" — the spec's own wording implies blocking).
// Volume throttle is a visible warning only, never a block — the spec is
// explicit about this ("Volume throttles with visible warnings"), and
// there's no single authoritative Google-published numeric threshold to
// block against; DEFAULT_VOLUME_WARNING_THRESHOLD below is a reasonable,
// clearly-labelled heuristic, not a documented policy figure.

export interface DuplicateCheckResult {
  isDuplicate: boolean
  mostSimilarArticleId?: string
  mostSimilarTitle?: string
  similarity: number
}

export interface VolumeCheckResult {
  count: number
  windowHours: number
  threshold: number
  isHighVolume: boolean
}

// Shingle-based Jaccard similarity — cheap, dependency-free, no external
// service. Not as accurate as a real embedding-similarity or simhash
// approach, but catches the case this check exists for: near-identical or
// lightly-templated regenerations, not subtle paraphrase plagiarism
// detection (that's a different, much harder problem out of scope here).
function shingles(text: string, size: number): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const set = new Set<string>()
  for (let i = 0; i <= words.length - size; i++) set.add(words.slice(i, i + size).join(' '))
  return set
}

export function jaccardSimilarity(textA: string, textB: string, shingleSize = 5): number {
  const shinglesA = shingles(textA, shingleSize)
  const shinglesB = shingles(textB, shingleSize)
  if (shinglesA.size === 0 || shinglesB.size === 0) return 0
  let intersection = 0
  for (const s of Array.from(shinglesA)) if (shinglesB.has(s)) intersection++
  const union = shinglesA.size + shinglesB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// Above this, two articles are similar enough to be "the same article
// republished," not just "covers similar ground" — picked conservatively
// (real near-duplicates from a regeneration bug or copy-paste error tend
// to land well above 0.8; 0.6 leaves room to catch templated output before
// that, e.g. a boilerplate structure repeated with only the keyword
// swapped) but this is a heuristic, not a validated figure — tune based on
// real false-positive/negative reports once this runs against real usage.
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6

// No official Google-published number exists for "how many articles per
// day looks like scaled abuse" — this is a conservative, clearly-labelled
// starting point for a WARNING (never a block, per the spec), tune once
// real usage data exists.
export const DEFAULT_VOLUME_WARNING_THRESHOLD = 5
export const DEFAULT_VOLUME_WINDOW_HOURS = 24

export async function checkNearDuplicate(
  supabase: any,
  userId: string,
  siteId: string,
  candidateHtml: string,
  excludeArticleId?: string,
): Promise<DuplicateCheckResult> {
  // Scoped to "other articles published to this site" — see the pages.site_id
  // migration's own comment for why this needed a schema change.
  const query = supabase
    .from('pages')
    .select('article_id, articles(id, title, content)')
    .eq('user_id', userId)
    .eq('site_id', siteId)
    .not('article_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(20)

  const { data: recentPages } = await query
  let best: DuplicateCheckResult = { isDuplicate: false, similarity: 0 }

  for (const page of recentPages || []) {
    const article = page.articles
    if (!article || article.id === excludeArticleId || !article.content) continue
    const similarity = jaccardSimilarity(candidateHtml, article.content)
    if (similarity > best.similarity) {
      best = {
        isDuplicate: similarity >= DUPLICATE_SIMILARITY_THRESHOLD,
        mostSimilarArticleId: article.id,
        mostSimilarTitle: article.title,
        similarity,
      }
    }
  }

  return best
}

export async function checkVolumeThrottle(
  supabase: any,
  userId: string,
  siteId: string,
  windowHours = DEFAULT_VOLUME_WINDOW_HOURS,
  threshold = DEFAULT_VOLUME_WARNING_THRESHOLD,
): Promise<VolumeCheckResult> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('pages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('site_id', siteId)
    .gte('published_at', since)

  const actualCount = count ?? 0
  return {
    count: actualCount,
    windowHours,
    threshold,
    isHighVolume: actualCount >= threshold,
  }
}
