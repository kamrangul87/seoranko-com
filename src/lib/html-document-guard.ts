// src/lib/html-document-guard.ts
// articles.content is a BODY-ONLY FRAGMENT by design: the real <head>/<body>
// for the live public page is built by
// app/(public)/blog/[brand]/[slug]/page.tsx's own generateMetadata + root
// layout, not by re-parsing this fragment (see content-render.ts's own
// comment on this). The model occasionally wraps its draft in a full
// <!DOCTYPE html><html><head>...</head> document skeleton anyway — when it
// does, everything the pipeline appends afterward (canonical link, OG/
// Twitter meta, JSON-LD schema) lands AFTER the model's own </html>, and the
// draft itself is missing a real <body> tag. This is a genuine structural
// defect wherever the raw fragment is consumed directly: the article-
// download export route, and the public page's extractRenderableBody, which
// only strips <meta>/<script>/<link rel="canonical"> children — not the
// <html>/<head>/<body> container tags themselves.

export interface DocumentGuardResult {
  html: string
  stripped: boolean
  strippedTags: string[]
}

/**
 * Removes stray document-wrapper tags, keeping their inner content — except
 * the whole <head> block, which is dropped entirely (its <title>/<meta>
 * children are either redundant with the H1 or duplicated by the pipeline's
 * own canonical/OG/schema injection later in the pipeline).
 */
export function stripStrayDocumentWrapperTags(html: string): DocumentGuardResult {
  if (!html) return { html, stripped: false, strippedTags: [] }

  let out = html
  const strippedTags: string[] = []

  if (/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi.test(out)) strippedTags.push('head')
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')

  if (/<!DOCTYPE\s+html[^>]*>/gi.test(out)) strippedTags.push('doctype')
  out = out.replace(/<!DOCTYPE\s+html[^>]*>/gi, '')

  if (/<\/?html\b[^>]*>/gi.test(out)) strippedTags.push('html')
  out = out.replace(/<\/?html\b[^>]*>/gi, '')

  if (/<\/?body\b[^>]*>/gi.test(out)) strippedTags.push('body')
  out = out.replace(/<\/?body\b[^>]*>/gi, '')

  out = out.replace(/\n{3,}/g, '\n\n').trim()

  return { html: out, stripped: strippedTags.length > 0, strippedTags }
}

/**
 * Post-condition: the final artifact must never contain a document-wrapper
 * tag. Returns a blocking reason when one is found — never silently ship
 * broken structure.
 */
export function assertNoDocumentWrapperTags(html: string): string | undefined {
  const found: string[] = []
  if (/<!DOCTYPE\s+html/i.test(html)) found.push('<!DOCTYPE html>')
  if (/<\/?html\b/i.test(html)) found.push('<html>')
  if (/<\/?head\b/i.test(html)) found.push('<head>')
  if (/<\/?body\b/i.test(html)) found.push('<body>')
  if (found.length === 0) return undefined
  return `Document-structure post-condition failed: article content contains stray ${found.join(', ')} tag(s) — articles.content is a body-only fragment; the live page supplies its own <head>/<body>.`
}
