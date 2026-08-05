// src/lib/scannability-fixer.ts
// A prompt instruction alone isn't a guarantee the model follows it — same
// lesson as merge-artifact-repair.ts. This mechanically splits any
// paragraph over 6 sentences at its midpoint sentence boundary, so
// structure-validator.ts's scannability check (and readers) never see a
// dense block regardless of whether the write prompt's SCANNABILITY RULE
// was actually followed.

export function autoSplitDenseParagraphs(articleHtml: string): string {
  return articleHtml.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, innerHtml) => {
    const plainText = innerHtml.replace(/<[^>]+>/g, '')
    const sentences = innerHtml.split(/(?<=[.!?])\s+(?=[A-Z<])/)

    const sentenceCount = (plainText.match(/[.!?]+/g) || []).length
    if (sentenceCount < 7 || sentences.length < 7) return match // leave as-is

    // Split roughly in half at a sentence boundary, preserving inline HTML
    // (links, <strong>, etc.) within each half rather than operating on
    // stripped plain text and losing markup.
    const midpoint = Math.ceil(sentences.length / 2)
    const firstHalf = sentences.slice(0, midpoint).join(' ').trim()
    const secondHalf = sentences.slice(midpoint).join(' ').trim()
    if (!firstHalf || !secondHalf) return match

    return `<p${attrs}>${firstHalf}</p>\n<p${attrs}>${secondHalf}</p>`
  })
}
