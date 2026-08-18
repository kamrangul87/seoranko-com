// src/lib/content-render.ts
// articles.content is the single source of truth for article HTML (per
// explicit product decision — no separate body_html column, to avoid two
// divergent copies of the same content). But content already has document-
// level tags baked in by the write pipeline itself: a model-written
// <meta name="robots">, appendSocialMetaTags' description/OG/Twitter <meta>
// tags, buildCanonicalTag's <link rel="canonical">, and schema-generator.ts's
// four <script type="application/ld+json"> blocks (Article/FAQPage/
// BreadcrumbList/Organization) — all originally meant to be read by the
// streaming preview UI, which has no real <head> of its own.
//
// The public route (app/(public)/blog/[brand]/[slug]/page.tsx) has a real
// <head>: its own generateMetadata emits title/description/canonical/OG from
// the dedicated articles columns, and injects schema_json directly. Rendering
// content verbatim inside that page's body would duplicate every one of
// those tags. extractRenderableBody is a deterministic, non-LLM transform
// (matches this project's "detect-and-repair beats prompt-only" rule) that
// strips exactly the document-level tags the public route re-emits itself,
// leaving the real reader-facing body (headings, prose, figures, FAQ blocks,
// author bio, "Last verified" line, table of contents) untouched.

import { parse } from 'node-html-parser'

export function extractRenderableBody(content: string): string {
  if (!content) return content
  const root = parse(content)

  for (const script of root.querySelectorAll('script')) {
    const type = (script.getAttribute('type') || '').toLowerCase()
    if (type === 'application/ld+json') script.remove()
  }
  for (const meta of root.querySelectorAll('meta')) meta.remove()
  for (const link of root.querySelectorAll('link[rel="canonical"]')) link.remove()

  return root.toString().replace(/\n{3,}/g, '\n\n').trim()
}
