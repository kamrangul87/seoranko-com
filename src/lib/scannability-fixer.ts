// src/lib/scannability-fixer.ts
// A prompt instruction alone isn't a guarantee the model follows it — same
// lesson as merge-artifact-repair.ts. This mechanically splits any
// paragraph over 6 sentences at its midpoint sentence boundary, so
// structure-validator.ts's scannability check (and readers) never see a
// dense block regardless of whether the write prompt's SCANNABILITY RULE
// was actually followed.

const META_PARAGRAPH_RE =
  /\bclass=["'][^"']*(?:article-meta|article-byline|article-dateline|article-last-verified)[^"']*["']/i

function splitDenseParagraphOnce(articleHtml: string): string {
  return articleHtml.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, innerHtml) => {
    if (META_PARAGRAPH_RE.test(match)) return match

    const plainText = innerHtml.replace(/<[^>]+>/g, '')
    const sentences = innerHtml.split(/(?<=[.!?])\s+(?=[A-Z<])/)

    const sentenceCount = (plainText.match(/[.!?]+/g) || []).length
    if (sentenceCount < 6 || sentences.length < 6) return match

    const midpoint = Math.ceil(sentences.length / 2)
    const firstHalf = sentences.slice(0, midpoint).join(' ').trim()
    const secondHalf = sentences.slice(midpoint).join(' ').trim()
    if (!firstHalf || !secondHalf) return match

    return `<p${attrs}>${firstHalf}</p>\n<p${attrs}>${secondHalf}</p>`
  })
}

export function autoSplitDenseParagraphs(articleHtml: string): string {
  let result = articleHtml
  for (let i = 0; i < 8; i++) {
    const next = splitDenseParagraphOnce(result)
    if (next === result) break
    result = next
  }
  return result
}
