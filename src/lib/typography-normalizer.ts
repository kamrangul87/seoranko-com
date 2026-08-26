// src/lib/typography-normalizer.ts
// Mechanically renders apostrophes and quotation marks as typographic
// (curly) characters in VISIBLE TEXT ONLY.
//
// Straight apostrophes are a rendering/style defect, not a spelling defect,
// but they arrive from the model in bulk (10+ per article) and every prose
// checker that can see them reports them. Normalizing them at the source
// removes the whole class of finding instead of relying on how a linter
// happens to classify it — and keeps genuine missing-apostrophe typos
// ("dont") visible, since those have no apostrophe to normalize.
//
// Never touches markup: tag names, attribute values (href/src/style/alt),
// <script> (including JSON-LD schema, where a curly quote would be invalid
// JSON), <style>, <code>/<pre>, or HTML comments.

const SKIP_ELEMENT_RE = /^(script|style|code|pre|textarea)$/i

const APOSTROPHE = '\u2019'
const LEFT_DOUBLE = '\u201C'
const RIGHT_DOUBLE = '\u201D'

/** Curly-quote one run of visible text. */
export function normalizeTextTypography(text: string): string {
  let out = text
    // Contractions and possessives: word'word / word's / s' at word end.
    .replace(/([A-Za-z0-9])'(?=[A-Za-z])/g, `$1${APOSTROPHE}`)
    .replace(/([A-Za-z0-9])'(?![A-Za-z])/g, `$1${APOSTROPHE}`)
    // Decade elisions ('90s) and common elided forms ('til, 'em).
    .replace(/'(?=\d{2}s\b)/g, APOSTROPHE)

  // Double quotes: alternate open/close based on the preceding character.
  out = out.replace(/"/g, (_m, offset: number, full: string) => {
    const prev = full[offset - 1]
    const opensHere = prev === undefined || /[\s(\[{\u2014\u2013-]/.test(prev)
    return opensHere ? LEFT_DOUBLE : RIGHT_DOUBLE
  })

  return out
}

/**
 * Run `transform` over every visible text run of an HTML fragment, leaving
 * markup, attributes, comments and skipped elements untouched.
 */
export function transformVisibleText(html: string, transform: (text: string) => string): string {
  if (!html) return html

  let result = ''
  let index = 0
  let skipDepth = 0
  const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = tagRe.exec(html)) !== null) {
    const text = html.slice(index, match.index)
    result += skipDepth > 0 ? text : transform(text)
    result += match[0]
    index = match.index + match[0].length

    const tagName = match[1]
    if (!tagName || !SKIP_ELEMENT_RE.test(tagName)) continue
    if (match[0].startsWith('</')) {
      skipDepth = Math.max(0, skipDepth - 1)
    } else if (!match[0].endsWith('/>')) {
      skipDepth++
    }
  }

  const tail = html.slice(index)
  result += skipDepth > 0 ? tail : transform(tail)
  return result
}

/**
 * Apply typographic normalization to every visible text node of an HTML
 * fragment. Idempotent: already-curly text is unchanged.
 */
export function normalizeArticleTypography(html: string): string {
  return transformVisibleText(html, normalizeTextTypography)
}
