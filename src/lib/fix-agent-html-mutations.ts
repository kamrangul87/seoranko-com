/**
 * Deterministic HTML mutations for Fix Agent auto-fixable issues.
 * Never invents business facts — only structural/meta derived from existing page data.
 */

import { stripStrayDocumentWrapperTags } from './html-document-guard'
import { schemaScriptTag } from './site-adapters/types'

export interface HtmlMutationResult {
  html: string
  changed: boolean
  summary: string
  /** Alt text was filename-derived and should be human-reviewed. */
  needsHumanReview?: boolean
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncateMeta(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

/** Ensure/replace <title> in a full HTML document or fragment. */
export function mutateMetaTitle(html: string, title: string): HtmlMutationResult {
  const safe = escapeHtml(truncateMeta(title, 60))
  if (!safe) return { html, changed: false, summary: 'No title available to set.' }

  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    const next = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${safe}</title>`)
    return { html: next, changed: next !== html, summary: `Updated <title> to "${title.slice(0, 60)}".` }
  }
  if (/<\/head>/i.test(html)) {
    const next = html.replace(/<\/head>/i, `<title>${safe}</title>\n</head>`)
    return { html: next, changed: true, summary: `Inserted <title> "${title.slice(0, 60)}".` }
  }
  // Body/fragment platforms: prepend a comment + rely on title API field separately
  const next = `<!-- seoranko-meta-title: ${safe} -->\n` + html
  return { html: next, changed: true, summary: `Marked meta title for platform title field: "${title.slice(0, 60)}".` }
}

export function mutateMetaDescription(html: string, description: string): HtmlMutationResult {
  const raw = truncateMeta(description, 155)
  if (raw.length < 50) {
    return { html, changed: false, summary: 'Description too short to set as meta description without inventing copy.' }
  }
  const safe = escapeHtml(raw)
  const tag = `<meta name="description" content="${safe}" />`

  if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
    const next = html.replace(/<meta\s+name=["']description["'][^>]*>/i, tag)
    return { html: next, changed: next !== html, summary: 'Updated meta description length/content from existing page text.' }
  }
  if (/<\/head>/i.test(html)) {
    return { html: html.replace(/<\/head>/i, `${tag}\n</head>`), changed: true, summary: 'Inserted meta description from existing page text.' }
  }
  // Inject into body as a head-equivalent for CMS body_html platforms
  const next = `${tag}\n` + html
  return { html: next, changed: true, summary: 'Injected meta description into page content (CMS body write).' }
}

export function mutateMissingH1(html: string, h1Text: string): HtmlMutationResult {
  if (/<h1\b/i.test(html)) {
    return { html, changed: false, summary: 'H1 already present.' }
  }
  const text = escapeHtml(h1Text.replace(/\s+/g, ' ').trim().slice(0, 120))
  if (!text) return { html, changed: false, summary: 'No existing title/brand to derive H1 from.' }
  const block = `<h1 class="seoranko-added-h1">${text}</h1>\n`
  if (/<body[^>]*>/i.test(html)) {
    return {
      html: html.replace(/<body[^>]*>/i, (m) => m + '\n' + block),
      changed: true,
      summary: `Inserted H1 derived from existing title: "${h1Text.slice(0, 80)}".`,
    }
  }
  return { html: block + html, changed: true, summary: `Prepended H1 derived from existing title: "${h1Text.slice(0, 80)}".` }
}

export function mutateLangAttribute(html: string, lang: string): HtmlMutationResult {
  const code = (lang || 'en').slice(0, 16).replace(/[^a-zA-Z-]/g, '') || 'en'
  if (/<html\b[^>]*\blang\s*=/i.test(html)) {
    const next = html.replace(/(<html\b[^>]*\blang\s*=\s*)(["'])[^"']*\2/i, `$1$2${code}$2`)
    return { html: next, changed: next !== html, summary: `Set html lang="${code}".` }
  }
  if (/<html\b/i.test(html)) {
    const next = html.replace(/<html\b/i, `<html lang="${code}"`)
    return { html: next, changed: true, summary: `Added lang="${code}" to <html>.` }
  }
  return { html, changed: false, summary: 'No <html> element in editable source — lang must be set in the theme/layout.' }
}

export function mutateImageAlt(html: string): HtmlMutationResult {
  let changed = false
  let flagged = 0
  const next = html.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
    if (/\balt\s*=/i.test(attrs)) return full
    const srcMatch = attrs.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i)
    const src = srcMatch?.[2] || ''
    const file = src.split('/').pop()?.split('?')[0] || ''
    const fromName = file
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\d{3,}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!fromName || fromName.length < 3) {
      flagged++
      // Empty alt = decorative; flag for human rather than inventing prose
      changed = true
      return `<img${attrs} alt="" data-seoranko-alt-review="1">`
    }
    changed = true
    flagged++
    return `<img${attrs} alt="${escapeHtml(fromName.slice(0, 100))}" data-seoranko-alt-review="1">`
  })
  if (!changed) return { html, changed: false, summary: 'No images missing alt.' }
  return {
    html: next,
    changed: true,
    summary: `Filled missing alt from filenames (${flagged} image(s)); flagged for human review.`,
    needsHumanReview: true,
  }
}

export function mutateHtmlStructure(html: string): HtmlMutationResult {
  // Only strip wrappers when this looks like a body fragment wrongly wrapped,
  // not when editing a full standalone HTML document (GitHub .html pages).
  const isFullDoc = /<!DOCTYPE\s+html/i.test(html) && /<html\b/i.test(html) && /<body\b/i.test(html)
  if (isFullDoc) {
    return { html, changed: false, summary: 'Full HTML document — structure wrappers are intentional.' }
  }
  const result = stripStrayDocumentWrapperTags(html)
  return {
    html: result.html,
    changed: result.stripped,
    summary: result.stripped
      ? `Removed stray document-wrapper tags: ${result.strippedTags.join(', ')}.`
      : 'No stray document-wrapper tags found.',
  }
}

export function injectSchemaIntoHtml(
  html: string,
  schemaJsonLd: Record<string, unknown>,
): HtmlMutationResult {
  const type = String(schemaJsonLd['@type'] || '')
  if (type && new RegExp(`"@type"\\s*:\\s*"${type}"`, 'i').test(html)) {
    return { html, changed: false, summary: `${type} schema already present.` }
  }
  const script = schemaScriptTag(schemaJsonLd)
  if (/<\/body>/i.test(html)) {
    return {
      html: html.replace(/<\/body>/i, `${script}</body>`),
      changed: true,
      summary: `Injected ${type || 'JSON-LD'} schema before </body>.`,
    }
  }
  if (/<\/head>/i.test(html)) {
    return {
      html: html.replace(/<\/head>/i, `${script}</head>`),
      changed: true,
      summary: `Injected ${type || 'JSON-LD'} schema into <head>.`,
    }
  }
  return { html: html + script, changed: true, summary: `Appended ${type || 'JSON-LD'} schema.` }
}

/** Build Organization schema from existing identity — no invented facts. */
export function buildOrganizationSchema(opts: {
  name: string
  url: string
  description?: string
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: opts.name,
    url: opts.url,
    ...(opts.description ? { description: opts.description.slice(0, 300) } : {}),
  }
}

export function buildArticleSchema(opts: {
  headline: string
  url: string
  brandName: string
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.headline.slice(0, 110),
    mainEntityOfPage: opts.url,
    author: { '@type': 'Organization', name: opts.brandName },
  }
}

export function buildBreadcrumbSchema(pageUrl: string): Record<string, unknown> | null {
  let u: URL
  try {
    u = new URL(pageUrl)
  } catch {
    return null
  }
  const segs = u.pathname.split('/').filter(Boolean)
  if (segs.length === 0) return null
  const items = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${u.origin}/` },
    ...segs.map((seg, i) => ({
      '@type': 'ListItem',
      position: i + 2,
      name: decodeURIComponent(seg).replace(/[-_]/g, ' '),
      item: `${u.origin}/${segs.slice(0, i + 1).join('/')}/`,
    })),
  ]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  }
}

/** Extract first meaningful paragraph / meta candidate from HTML body text. */
export function deriveDescriptionFromHtml(html: string, fallbackTitle: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length >= 80) return truncateMeta(text, 155)
  if (fallbackTitle.length >= 30) return truncateMeta(`${fallbackTitle}. Learn more on this page.`, 155)
  return ''
}

export function buildLlmsTxt(opts: { brand: string; siteUrl: string; title?: string }): string {
  const brand = opts.brand || 'Site'
  const url = opts.siteUrl.replace(/\/+$/, '')
  return [
    `# ${brand}`,
    '',
    `> ${brand} — site overview for AI assistants.`,
    '',
    `Site: ${url}`,
    opts.title ? `Primary page: ${opts.title}` : '',
    '',
    '## Notes',
    '- This file was created by SEORANKO Fix Agent from existing site identity.',
    '- Do not invent pricing, stock, or policy claims from this file alone.',
    '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
}
