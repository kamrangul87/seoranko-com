/**
 * Path A — paste page HTML/content, return the same content with one mechanical fix applied.
 * Never invents marketing copy — only trims/restructures existing text or adds tags from crawl data.
 */

import {
  computeFixedMetaDescription,
  computeFixedTitle,
  deriveH1FromTitle,
  extractHeadFields,
  type ContentPasteFixKind,
} from './onpage-fix-values'
import {
  mutateMetaDescription,
  mutateMetaTitle,
  mutateMissingH1,
} from './fix-agent-html-mutations'

export interface PasteFixRequest {
  html: string
  fixKind: ContentPasteFixKind
  /** When fixing canonical — the URL this page should canonicalize to. */
  canonicalUrl?: string
  /** Sitemap XML blocks to merge when fixKind is sitemap_entries. */
  sitemapEntries?: string
}

export interface PasteFixResult {
  ok: boolean
  html: string
  summary: string
  fixKind: ContentPasteFixKind
  error?: string
  /** When no canonical tag exists in pasted HTML — line to add manually. */
  suggestedManualLine?: string
}

function insertSitemapEntries(existing: string, entries: string): string {
  const blocks = entries.trim()
  if (!blocks) return existing
  if (/<\/urlset>/i.test(existing)) {
    return existing.replace(/<\/urlset>/i, `${blocks}\n</urlset>`)
  }
  if (/<urlset/i.test(existing)) {
    return `${existing.trim()}\n${blocks}\n</urlset>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${blocks}\n</urlset>`
}

const CANONICAL_LINK_RE = /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i

function mutateCanonicalTag(html: string, canonicalUrl: string): PasteFixResult {
  if (!canonicalUrl) {
    return { ok: false, html, summary: '', fixKind: 'canonical_tag', error: 'Canonical URL is required.' }
  }

  const suggestedManualLine = `<link rel="canonical" href="${canonicalUrl}">`
  const match = html.match(CANONICAL_LINK_RE)
  if (!match) {
    return {
      ok: false,
      html,
      summary: '',
      fixKind: 'canonical_tag',
      error:
        'No canonical tag found in what you pasted — paste the full <head> section, or add this line manually:',
      suggestedManualLine,
    }
  }

  const originalTag = match[0]
  let fixedTag = originalTag
  if (/href\s*=/i.test(originalTag)) {
    fixedTag = originalTag.replace(/href\s*=\s*(["'])([^"']*)\1/i, `href=$1${canonicalUrl}$1`)
  } else {
    fixedTag = originalTag.replace(/\/?>$/, ` href="${canonicalUrl}">`)
  }

  if (fixedTag === originalTag) {
    return {
      ok: false,
      html,
      summary: '',
      fixKind: 'canonical_tag',
      error: 'Found a canonical tag but could not update its href — check the tag format or edit it manually.',
      suggestedManualLine,
    }
  }

  const next = html.replace(originalTag, fixedTag)
  return {
    ok: true,
    html: next,
    summary: `Updated canonical href to ${canonicalUrl} (self-reference from crawl evidence). No other content changed.`,
    fixKind: 'canonical_tag',
  }
}

export function applyPasteAndFix(req: PasteFixRequest): PasteFixResult {
  const { html, fixKind } = req
  if (!html.trim()) {
    return { ok: false, html, summary: '', fixKind, error: 'Paste your page HTML or content first.' }
  }

  const fields = extractHeadFields(html)

  switch (fixKind) {
    case 'meta_title': {
      if (!fields.title) {
        return { ok: false, html, summary: '', fixKind, error: 'No <title> tag found in pasted HTML.' }
      }
      if (fields.title.length <= 60) {
        return {
          ok: false,
          html,
          summary: '',
          fixKind,
          error: `Title is already ${fields.title.length} characters (limit 60). Nothing to shorten.`,
        }
      }
      const fixed = computeFixedTitle(fields.title, fields.h1)
      const result = mutateMetaTitle(html, fixed)
      return {
        ok: result.changed,
        html: result.html,
        summary: result.summary,
        fixKind,
        error: result.changed ? undefined : 'Could not update title in pasted HTML.',
      }
    }
    case 'meta_description': {
      const fixed = computeFixedMetaDescription(fields.metaDescription, fields.h1)
      if (!fixed) {
        return { ok: false, html, summary: '', fixKind, error: 'No meta description to fix and not enough existing text to derive one.' }
      }
      const result = mutateMetaDescription(html, fixed)
      return {
        ok: result.changed,
        html: result.html,
        summary: result.summary,
        fixKind,
        error: result.changed ? undefined : 'Could not update meta description.',
      }
    }
    case 'missing_h1': {
      const h1Text = deriveH1FromTitle(fields.title, fields.h2s[0])
      const result = mutateMissingH1(html, h1Text)
      return {
        ok: result.changed,
        html: result.html,
        summary: result.summary,
        fixKind,
        error: result.changed ? undefined : result.summary,
      }
    }
    case 'canonical_tag':
      return mutateCanonicalTag(html, req.canonicalUrl || '')
    case 'sitemap_entries': {
      if (!req.sitemapEntries?.trim()) {
        return { ok: false, html, summary: '', fixKind, error: 'No sitemap entries to insert.' }
      }
      const next = insertSitemapEntries(html, req.sitemapEntries)
      return {
        ok: next !== html,
        html: next,
        summary: 'Inserted crawl-derived <url> blocks into your sitemap (no lastmod/priority invented).',
        fixKind,
      }
    }
    default:
      return { ok: false, html, summary: '', fixKind, error: 'Unsupported fix type.' }
  }
}

/** Map audit issue title to paste-fix kind when detectable. */
export function pasteFixKindFromAuditIssue(title: string, description: string): ContentPasteFixKind | null {
  const hay = `${title} ${description}`.toLowerCase()
  if (/title too long|title too short|missing title/.test(hay)) return 'meta_title'
  if (/meta description too long|meta description too short|missing meta description/.test(hay)) return 'meta_description'
  if (/missing h1/.test(hay)) return 'missing_h1'
  if (/canonical/.test(hay)) return 'canonical_tag'
  return null
}
