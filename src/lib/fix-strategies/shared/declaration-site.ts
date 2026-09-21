/**
 * Topic 70–aligned declaration-site classification for register-wide rollup.
 *
 * Shared layouts, components, generators, and site config produce the same
 * defect on N pages — report once naming the site (topic 33 principle).
 * Page-local files stay per-URL.
 */

export type DeclarationSiteKind =
  | 'shared-layout'
  | 'shared-component'
  | 'generator'
  | 'shared-config'
  | 'page'
  | 'unknown'

const LAYOUT_RE =
  /(^|\/)(layout|template)(\.[a-z]+)?$/i

const SHARED_COMPONENT_RE =
  /(^|\/)(nav|navbar|navigation|header|footer|site-header|site-footer|main-nav)(\.|\/)|(^|\/)[^/]*(nav|header|footer|layout|jsonld|json-ld|schema|seo|metadata)[^/]*\.(tsx|ts|jsx|js)$/i

const GENERATOR_RE =
  /(^|\/)(robots|sitemap|i18n|generateMetadata)|generator|generated/i

const CONFIG_RE =
  /(^|\/)(next\.config\.|vercel\.json|middleware\.)|trailingSlash|cleanUrls/i

const PAGE_RE = /(^|\/)page\.(tsx|ts|jsx|js)$/i

/**
 * Classify a repo-relative path or logical declaration id.
 * Logical ids may use prefixes: `generator:…`, `layout:…`, `component:…`, `config:…`.
 */
export function classifyDeclarationSite(
  site: string | null | undefined,
): DeclarationSiteKind {
  if (site == null || site.trim() === '') return 'unknown'
  const s = site.trim().replace(/\\/g, '/')

  if (/^generator:/i.test(s) || GENERATOR_RE.test(s)) return 'generator'
  if (/^config:/i.test(s) || CONFIG_RE.test(s)) return 'shared-config'
  if (/^layout:/i.test(s) || LAYOUT_RE.test(s)) return 'shared-layout'
  if (/^component:/i.test(s) || SHARED_COMPONENT_RE.test(s)) {
    return 'shared-component'
  }
  if (PAGE_RE.test(s)) return 'page'
  // components/ without page.tsx — treat as shared component when under
  // components/ or src/components/
  if (/(^|\/)components\//i.test(s)) return 'shared-component'
  return 'unknown'
}

/** Layouts, shared components, generators, and site config collapse across pages. */
export function isCollapsibleDeclarationSite(
  kind: DeclarationSiteKind,
): boolean {
  return (
    kind === 'shared-layout' ||
    kind === 'shared-component' ||
    kind === 'generator' ||
    kind === 'shared-config'
  )
}
