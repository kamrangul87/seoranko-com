/**
 * Single source of truth for the Write-page score rings
 * (E-E-A-T / Readability / Keyword Density).
 *
 * Both the generation stream (SEORANKO_SCORES) and Fix All / recheck
 * must compute these from the SAME HTML the Quality Gate scored —
 * never from an earlier draft, and never hardcode zeros when a gate
 * result exists.
 */

import {
  calculateEEATScore,
  calculateReadabilityScore,
  analyzeKeywordDensity,
} from '@/lib/content-scorer'
import { primaryTopicPhrase, coreKeywordPhrase } from '@/lib/topic-alignment'

export interface PanelScores {
  eeatScore: number
  readabilityScore: number
  keywordDensity: number
  keywordDensityScore: number
}

export function densityTargetForKeyword(keyword: string): string {
  return primaryTopicPhrase(keyword) || coreKeywordPhrase(keyword) || keyword
}

/** Scores for the rings above the Quality Gate — always from the given HTML. */
export function computePanelScores(html: string, keyword: string): PanelScores {
  const dens = analyzeKeywordDensity(html, densityTargetForKeyword(keyword))
  return {
    eeatScore: calculateEEATScore(html),
    readabilityScore: calculateReadabilityScore(html),
    keywordDensity: dens.density,
    keywordDensityScore: dens.score,
  }
}

/** Parse panel scores from a SEORANKO_SCORES JSON payload (partial or final). */
export function panelScoresFromMeta(meta: Record<string, unknown>): PanelScores | null {
  const eeat = meta.eeatScore
  const readability = meta.readabilityScore
  const density = meta.keywordDensity
  const densityScore = meta.keywordDensityScore
  if (
    typeof eeat !== 'number' &&
    typeof readability !== 'number' &&
    typeof densityScore !== 'number' &&
    typeof density !== 'number'
  ) {
    return null
  }
  const kw =
    typeof density === 'number'
      ? density
      : typeof density === 'string'
        ? parseFloat(density) || 0
        : 0
  return {
    eeatScore: typeof eeat === 'number' ? eeat : 0,
    readabilityScore: typeof readability === 'number' ? readability : 0,
    keywordDensity: kw,
    keywordDensityScore:
      typeof densityScore === 'number'
        ? densityScore
        : Math.min(100, Math.round(kw * 10)),
  }
}
