// src/lib/fact-density.ts
// Scores article fact density for AEO/GEO readiness
// Target: at least 1 verifiable fact per 100 words (Princeton research: +40% AI visibility)

export interface FactDensityResult {
  score: number          // 0–100
  factsFound: number
  wordCount: number
  factsPerHundredWords: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  suggestions: string[]
  breakdown: {
    statistics: number      // e.g. "40% of users", "3× faster"
    namedEntities: number   // proper nouns: companies, people, places, products
    specificDates: number   // years, months, specific timeframes
    citedClaims: number     // "according to X", "research shows", "study by Y"
    numbers: number         // any specific numeric value
  }
}

export function scoreFactDensity(articleContent: string): FactDensityResult {
  const cleanText = articleContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const wordCount = cleanText.split(' ').filter(w => w.length > 0).length

  // Statistics pattern: percentages, multipliers, ratios
  const statisticsPattern = /\b\d+(\.\d+)?(%|percent|x|×|times|fold)\b|\b\d+\s*(out of|in)\s*\d+\b/gi
  const statistics = (cleanText.match(statisticsPattern) || []).length

  // Named entities: capitalised multi-word phrases, company names
  const namedEntityPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g
  const namedEntities = (cleanText.match(namedEntityPattern) || []).length

  // Specific dates and timeframes
  const datePattern = /\b(19|20)\d{2}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b|\bin\s+Q[1-4]\s+\d{4}\b/gi
  const specificDates = (cleanText.match(datePattern) || []).length

  // Cited claims: attribution phrases
  const citationPattern = /\b(according to|research (shows|found|suggests)|study by|reported by|data from|survey (shows|found)|analysis (shows|found)|per|source:)\b/gi
  const citedClaims = (cleanText.match(citationPattern) || []).length

  // Any specific numbers (not already caught above)
  const numberPattern = /\b\d+(\.\d+)?\b/g
  const allNumbers = (cleanText.match(numberPattern) || []).length
  const numbers = Math.max(0, allNumbers - statistics - specificDates)

  const factsFound = statistics + Math.min(namedEntities, 10) + specificDates + citedClaims + Math.min(numbers, 5)
  const factsPerHundredWords = wordCount > 0 ? (factsFound / wordCount) * 100 : 0

  // Grade: A = 2+ facts/100 words, B = 1.5+, C = 1+, D = 0.5+, F = below 0.5
  let grade: 'A' | 'B' | 'C' | 'D' | 'F'
  let score: number
  if (factsPerHundredWords >= 2) { grade = 'A'; score = 90 + Math.min(10, (factsPerHundredWords - 2) * 5) }
  else if (factsPerHundredWords >= 1.5) { grade = 'B'; score = 75 + ((factsPerHundredWords - 1.5) / 0.5) * 15 }
  else if (factsPerHundredWords >= 1) { grade = 'C'; score = 55 + ((factsPerHundredWords - 1) / 0.5) * 20 }
  else if (factsPerHundredWords >= 0.5) { grade = 'D'; score = 30 + ((factsPerHundredWords - 0.5) / 0.5) * 25 }
  else { grade = 'F'; score = Math.max(0, factsPerHundredWords * 60) }

  const suggestions: string[] = []
  if (statistics < 3) suggestions.push('Add more statistics and percentages (e.g. "X% of users", "3× faster")')
  if (citedClaims < 2) suggestions.push('Attribute claims to sources (e.g. "According to Google...", "Research by MIT shows...")')
  if (specificDates < 1) suggestions.push('Include specific years or timeframes to ground claims in time')
  if (factsPerHundredWords < 1) suggestions.push('Aim for at least 1 verifiable fact per 100 words to maximise AI citation potential')

  return {
    score: Math.round(Math.min(100, score)),
    factsFound,
    wordCount,
    factsPerHundredWords: Math.round(factsPerHundredWords * 10) / 10,
    grade,
    suggestions,
    breakdown: { statistics, namedEntities: Math.min(namedEntities, 50), specificDates, citedClaims, numbers: Math.min(numbers, 20) }
  }
}
