// src/lib/structure-validator.ts
// Checks heading hierarchy correctness, image placement, and
// scannability — runs automatically on every article, catching
// structural regressions the same way the schema validator catches
// missing schema fields.

export interface StructureIssue {
  severity: 'critical' | 'warning'
  category: 'heading-hierarchy' | 'image-placement' | 'scannability' | 'heading-rhythm'
  message: string
}

export function validateArticleStructure(articleHtml: string): StructureIssue[] {
  const issues: StructureIssue[] = []

  // --- Heading hierarchy ---
  const h1Count = (articleHtml.match(/<h1[^>]*>/gi) || []).length
  if (h1Count === 0) {
    issues.push({ severity: 'critical', category: 'heading-hierarchy', message: 'No H1 found — every article needs exactly one.' })
  } else if (h1Count > 1) {
    issues.push({ severity: 'critical', category: 'heading-hierarchy', message: `${h1Count} H1 tags found — should be exactly one.` })
  }

  // Check for skipped levels (H1 -> H3 with no H2, or H2 -> H4 with no H3)
  const headingSequence = Array.from(articleHtml.matchAll(/<h([1-6])[^>]*>/gi)).map(m => Number(m[1]))
  for (let i = 1; i < headingSequence.length; i++) {
    if (headingSequence[i] - headingSequence[i - 1] > 1) {
      issues.push({
        severity: 'warning',
        category: 'heading-hierarchy',
        message: `Heading level jumps from H${headingSequence[i - 1]} to H${headingSequence[i]} — skipped a level.`
      })
    }
  }

  // --- Image placement: figure immediately after a heading, before any <p> ---
  const headingThenFigure = /<\/h[1-6]>\s*<figure/gi
  const badPlacements = (articleHtml.match(headingThenFigure) || []).length
  if (badPlacements > 0) {
    issues.push({
      severity: 'warning',
      category: 'image-placement',
      message: `${badPlacements} image(s) placed immediately after a heading with no lead-in text — breaks the heading→text→image flow.`
    })
  }

  // --- Scannability: count paragraphs over ~6 sentences with no list/bold nearby ---
  const paragraphs = articleHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []
  let denseParagraphCount = 0
  for (const p of paragraphs) {
    const plainText = p.replace(/<[^>]+>/g, '')
    const sentenceCount = (plainText.match(/[.!?]+/g) || []).length
    if (sentenceCount >= 6) denseParagraphCount++
  }
  if (denseParagraphCount >= 3) {
    issues.push({
      severity: 'warning',
      category: 'scannability',
      message: `${denseParagraphCount} paragraphs are 6+ sentences with no breaks — reduces scannability. Consider shorter paragraphs, bullet lists, or bolded key terms.`
    })
  }

  // --- Heading rhythm: repeated first word across H2s ---
  const h2Texts = Array.from(articleHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi))
    .map(m => m[1].replace(/<[^>]+>/g, '').trim())
    .filter(t => t.toLowerCase() !== 'frequently asked questions')
  const firstWords = h2Texts.map(h => h.split(' ')[0].toLowerCase())
  const wordCounts: Record<string, number> = {}
  for (const w of firstWords) wordCounts[w] = (wordCounts[w] || 0) + 1

  const maxRepeat = Math.max(...Object.values(wordCounts), 0)
  if (h2Texts.length > 0 && maxRepeat > h2Texts.length / 2) {
    const repeatedWord = Object.entries(wordCounts).find(([, c]) => c === maxRepeat)?.[0]
    issues.push({
      severity: 'warning',
      category: 'heading-rhythm',
      message: `${maxRepeat} of ${h2Texts.length} H2 headings start with "${repeatedWord}" — vary the rhythm so the article doesn't feel templated.`
    })
  }

  return issues
}
