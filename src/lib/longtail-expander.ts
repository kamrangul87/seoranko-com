// src/lib/longtail-expander.ts
// Finds genuinely easier-to-rank long-tail variants of a keyword — filtered
// so they're actually long-tail (more words than the head term) and actually
// lower-difficulty, not just "related". Reuses fetchKeywords() from
// lib/dataforseo.ts (same product/auth as the Keywords screen) rather than
// standing up a second DataForSEO integration.

import { fetchKeywords } from '@/lib/dataforseo'

export interface LongTailKeyword {
  keyword: string
  volume: number
  difficulty: number
  parentKeyword: string
}

export async function findLongTailVariants(
  primaryKeyword: string,
  country: string = 'UK',
  maxResults: number = 8
): Promise<LongTailKeyword[]> {
  let candidates
  try {
    candidates = await fetchKeywords(primaryKeyword, country)
  } catch (err) {
    console.warn('[longtail-expander] DataForSEO lookup failed, skipping expansion:', err)
    return []
  }

  const primaryWordCount = primaryKeyword.trim().split(/\s+/).filter(Boolean).length

  return candidates
    .filter(r => {
      const wordCount = r.keyword.trim().split(/\s+/).filter(Boolean).length
      return wordCount > primaryWordCount + 1 && r.volume >= 10 && r.kd < 40
    })
    .slice(0, maxResults)
    .map(r => ({
      keyword: r.keyword,
      volume: r.volume,
      difficulty: r.kd,
      parentKeyword: primaryKeyword,
    }))
}

// Scales how many long-tail terms to weave in with article length — the
// density-protection cap. Even long articles cap at 4, so long-tail terms
// add ranking surface area without competing with the primary keyword for
// relevance signal.
export function calculateSafeLongTailCount(targetWordCount: number): number {
  if (targetWordCount < 1200) return 2
  if (targetWordCount < 2000) return 3
  return 4
}
