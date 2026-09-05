/**
 * Mechanical on-page fix values — trim/restructure existing text only, no invented copy.
 * Shared by site audit scorer, Fix Agent, and Manual Fix paste-and-fix.
 */

export const TITLE_MAX = 60
export const META_DESC_MAX = 160
export const META_DESC_MIN = 70

export function computeFixedTitle(title: string, h1?: string, domain?: string): string {
  if (!title.trim()) return (h1?.slice(0, 55) || domain || '').trim()
  const words = title.replace(/\s*[|—\-]\s*.{10,}$/, '').trim().split(/\s+/)
  let out = ''
  for (const w of words) {
    if ((out + ' ' + w).trim().length <= 55) out = (out + ' ' + w).trim()
    else break
  }
  return out || title.slice(0, 55)
}

export function computeFixedMetaDescription(meta: string, h1?: string, domain?: string): string {
  if (!meta.trim()) {
    const base = h1 || domain || ''
    if (!base) return ''
    return `${base.slice(0, 80)}`.slice(0, 140)
  }
  if (meta.length > META_DESC_MAX) return meta.slice(0, 157) + '...'
  if (meta.length < META_DESC_MIN) {
    const expanded = `${meta} ${h1 || domain || ''}`.trim()
    return expanded.slice(0, 140)
  }
  return meta
}

export function deriveH1FromTitle(title: string, h2?: string, domain?: string): string {
  if (!title.trim()) return (h2 || domain || '').trim()
  return title.replace(/\s*[|—\-]\s*.{5,}$/, '').trim().slice(0, 70)
}

export function extractHeadFields(html: string): {
  title: string
  metaDescription: string
  h1: string
  h2s: string[]
} {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || ''
  const metaDescription =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim() ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i)?.[1]?.trim() ||
    ''
  const h1Matches = Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi))
  const h1 = h1Matches[0]?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || ''
  const h2s = Array.from(html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi))
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return { title, metaDescription, h1, h2s }
}

export type ContentPasteFixKind =
  | 'meta_title'
  | 'meta_description'
  | 'missing_h1'
  | 'canonical_tag'
  | 'sitemap_entries'
  | 'link_href'

export function detectContentFixKind(
  html: string,
  opts?: { titleTooLong?: boolean; metaTooLong?: boolean; missingH1?: boolean },
): ContentPasteFixKind | null {
  const { title, metaDescription, h1 } = extractHeadFields(html)
  if (opts?.titleTooLong || (title && title.length > TITLE_MAX)) return 'meta_title'
  if (opts?.metaTooLong || (metaDescription && metaDescription.length > META_DESC_MAX)) return 'meta_description'
  if (opts?.missingH1 || (!h1 && /<html/i.test(html))) return 'missing_h1'
  if (/<link\b[^>]+rel=["']canonical["']/i.test(html) === false && /<head/i.test(html)) return 'canonical_tag'
  return null
}
