/**
 * Single source of truth for article meta description extraction.
 * Used by article-v2, social tags, schema, repair cron, and scorers.
 *
 * Historical bug: `/<!-- META:\s*([^-]+?)\s*-->/` stopped at the first hyphen
 * ("off-peak", "UK-based", etc.), so extraction failed and every downstream
 * consumer fell back to "Article about {keyword}" — while the model often
 * still emitted a good <meta name="description"> earlier in the HTML.
 */

const GENERIC_ABOUT = /^article about\b/i

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function cleanDesc(raw: string): string {
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim()
}

/** Truncate at the nearest word/sentence boundary under `max`, never mid-word. */
export function truncateAtWordBoundary(text: string, max: number, ellipsis = false): string {
  const cleaned = cleanDesc(text)
  if (!cleaned || cleaned.length <= max) return cleaned

  const budget = ellipsis ? Math.max(1, max - 3) : max
  let slice = cleaned.slice(0, budget)

  // Prefer sentence end
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (sentenceEnd >= Math.floor(budget * 0.55)) {
    slice = slice.slice(0, sentenceEnd + 1).trim()
  } else {
    const sp = slice.lastIndexOf(' ')
    if (sp >= Math.floor(budget * 0.5)) slice = slice.slice(0, sp).trim()
    else slice = slice.trim()
  }

  // Strip dangling punctuation left by the cut
  slice = slice.replace(/[,:;–—-]+$/g, '').trim()
  if (!slice) return cleaned.slice(0, budget).trim()
  return ellipsis ? `${slice}...` : slice
}

function isGenericFallback(desc: string, keyword?: string): boolean {
  if (!desc) return true
  if (GENERIC_ABOUT.test(desc)) return true
  if (keyword && desc.toLowerCase() === `article about ${keyword.toLowerCase()}`) return true
  return false
}

/** Extract <!-- META: ... --> — hyphens and em-dashes are allowed inside. */
export function extractMetaComment(html: string): string | null {
  const match = html.match(/<!--\s*META:\s*([\s\S]*?)\s*-->/i)
  const text = match?.[1] ? cleanDesc(match[1]) : ''
  return text || null
}

export function extractMetaNameDescription(html: string): string | null {
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["'][^>]*>/i)
  const text = match?.[1] ? cleanDesc(match[1]) : ''
  return text || null
}

function extractOgOrTwitterDescription(html: string): string | null {
  const og = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["'][^>]*>/i)
  if (og?.[1]) return cleanDesc(og[1])
  const tw = html.match(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']*)["'][^>]*>/i)
  if (tw?.[1]) return cleanDesc(tw[1])
  return null
}

function extractFirstParagraph(html: string): string | null {
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  if (!match?.[1]) return null
  const text = cleanDesc(match[1].replace(/<[^>]+>/g, ' '))
  if (text.length < 40) return null
  return truncateAtWordBoundary(text, 160)
}

/**
 * Best available description for schema / OG / DB.
 * Prefer META comment → existing name=description → OG/Twitter → first paragraph → keyword fallback.
 * Never returns the broken "Article about X" string when better text exists.
 */
export function extractArticleDescription(html: string, keyword = ''): string {
  const candidates = [
    extractMetaComment(html),
    extractMetaNameDescription(html),
    extractOgOrTwitterDescription(html),
    extractFirstParagraph(html),
  ].filter((c): c is string => !!c && !isGenericFallback(c, keyword))

  if (candidates.length > 0) {
    const best = candidates[0]
    return best.length > 160 ? truncateAtWordBoundary(best, 160, true) : best
  }

  if (keyword.trim()) {
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    const title = titleMatch ? cleanDesc(titleMatch[1].replace(/<[^>]+>/g, ' ')) : ''
    if (title.length >= 40) return truncateAtWordBoundary(title, 160)
    return truncateAtWordBoundary(
      `${keyword.trim()} — practical guide with costs, options, and what to check before you buy.`,
      160,
    )
  }

  return ''
}

/** Remove SEO/social description tags so we can re-append a single consistent set. */
export function stripSeoDescriptionTags(html: string): string {
  return html
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+content=["'][^"']*["']\s+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+property=["']og:description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']twitter:description["'][^>]*>\s*/gi, '')
}

/** Keep at most one name=description (first non-generic wins). */
export function dedupeMetaDescriptionTags(html: string): string {
  const tags = Array.from(html.matchAll(/<meta\s+(?:name=["']description["'][^>]*|content=["'][^"']*["']\s+name=["']description["'][^>]*)>/gi))
  if (tags.length <= 1) return html

  let kept: string | null = null
  let out = html
  for (const m of tags) {
    const tag = m[0]
    const contentMatch = tag.match(/content=["']([^"']*)["']/i)
    const content = contentMatch ? cleanDesc(contentMatch[1]) : ''
    if (!kept && content && !isGenericFallback(content)) {
      kept = tag
      continue
    }
    if (!kept) {
      kept = tag
      continue
    }
    out = out.replace(tag, '')
  }
  // Drop leftover generics if we kept a good one
  if (kept && !isGenericFallback((kept.match(/content=["']([^"']*)["']/i)?.[1] || ''))) {
    for (const m of Array.from(out.matchAll(/<meta\s+(?:name=["']description["'][^>]*|content=["'][^"']*["']\s+name=["']description["'][^>]*)>/gi))) {
      const content = m[0].match(/content=["']([^"']*)["']/i)?.[1] || ''
      if (isGenericFallback(cleanDesc(content)) || m[0] !== kept) {
        if (m[0] !== kept) out = out.replace(m[0], '')
      }
    }
  }
  return out.replace(/\n{3,}/g, '\n\n')
}
