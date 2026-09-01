/**
 * Classify Site Audit issues as auto-fixable vs human-guided.
 * Thin content / internal linking / factual claims NEVER auto-fix.
 *
 * Connection type matters: a Universal Tag (client-side JS) cannot set HTTP
 * response headers or write static files — those require server/CMS access.
 */

import type { PageAuditIssue } from './page-audit-engine'

export type Fixability = 'auto' | 'human' | 'skip'

export type AutoFixKind =
  | 'meta-title'
  | 'meta-description'
  | 'missing-h1'
  | 'schema-organization'
  | 'schema-article'
  | 'schema-product'
  | 'schema-breadcrumb'
  | 'lang-attribute'
  | 'image-alt'
  | 'llms-txt'
  | 'html-structure'
  | 'security-headers'
  | 'redirect-canonical'
  | 'remove-dead-link'
  | 'sitemap-regenerate'

export type HumanFixKind =
  | 'thin-content'
  | 'internal-linking'
  | 'factual-claim'
  | 'requires-server'
  | 'missing-page-content'
  | 'other-editorial'

export type SiteConnectionType =
  | 'wordpress'
  | 'shopify'
  | 'webflow'
  | 'github'
  | 'universal-tag'
  | string

export interface ClassifyOptions {
  /** Active site connection platform. Omit / unknown → conservative (no header auto-fix). */
  connectionType?: SiteConnectionType | null
}

export interface ClassifiedIssue {
  issue: PageAuditIssue
  fixability: Fixability
  autoKind?: AutoFixKind
  humanKind?: HumanFixKind
  reason: string
  /** Plain UI hint when the fix path depends on upgrading the connection. */
  fixPathHint?: string
}

/** Platforms that can modify server config / response headers / static files. */
export const SERVER_CMS_CONNECTION_TYPES = new Set([
  'wordpress',
  'shopify',
  'webflow',
  'github',
])

/** Auto-fix kinds a client-side Universal Tag can actually apply post-load. */
export const UNIVERSAL_TAG_SAFE_AUTO_KINDS = new Set<AutoFixKind>([
  'meta-title',
  'meta-description',
  'missing-h1',
  'schema-organization',
  'schema-article',
  'schema-product',
  'schema-breadcrumb',
  'lang-attribute',
  'image-alt',
  'html-structure',
])

export function isServerCmsConnection(connectionType?: string | null): boolean {
  if (!connectionType) return false
  return SERVER_CMS_CONNECTION_TYPES.has(connectionType)
}

export function isUniversalTagConnection(connectionType?: string | null): boolean {
  return connectionType === 'universal-tag'
}

/** Human-readable list of what Fix Agent will attempt for this connection. */
export function describeFixableScope(connectionType?: string | null): string {
  if (isUniversalTagConnection(connectionType)) {
    return 'Via Universal Tag: meta tags, JSON-LD schema, H1/headings, image alt, and visible structure only. HTTP security headers and static files (llms.txt) require WordPress, Shopify, or GitHub.'
  }
  if (isServerCmsConnection(connectionType)) {
    return `Via ${connectionType}: structural meta/schema/H1/alt fixes, redirects, dead-link removal, sitemap updates, and header/static-file fixes when the platform allows.`
  }
  return 'Connect via WordPress, Shopify, or GitHub for the widest auto-fix coverage. A Universal Tag can only change post-load DOM (not HTTP headers).'
}

const THIN_RE = /thin content|low word count|lacks indexable copy|thin product description|placeholder product/i
const INTERNAL_LINK_RE = /internal link|related-product linking|orphan|link strategy/i
const FACTUAL_RE = /availability mismatch|pricing|stock claim|policy statement|invent/i

// Match Site Audit scorer copy ("Title too long…") and stable audit-meta_title ids —
// not only "title tag" phrasing (see fix-agent.test.ts scorer-message cases).
const META_TITLE_RE =
  /title tag|meta title|title too (long|short)|weak \/ templated product title|missing title|meta_title|audit-meta_title/i
const META_DESC_RE = /meta description|description too (short|long)|thin meta/i
const H1_RE = /missing h1|no h1|h1 missing|category page missing h1/i
const SCHEMA_ORG_RE = /organization schema|missing organization/i
const SCHEMA_ARTICLE_RE = /article schema|missing article/i
const SCHEMA_PRODUCT_RE = /product schema|offer missing|product brand missing|no sku/i
const SCHEMA_BREADCRUMB_RE = /breadcrumb/i
const LANG_RE = /lang attribute|missing lang/i
const ALT_RE = /alt text|images missing alt/i
const LLMS_RE = /llms\.txt/i
const HTML_STRUCT_RE = /html structure|tags outside|document wrapper|stray <\/?(?:html|head|body)/i
const SECURITY_RE = /x-frame-options|x-content-type|content-security-policy|security header|hsts/i
const REDIRECT_CANONICAL_RE = /idx-canonical-|redirect-canonical|index\.html canonical points elsewhere/i
const DEAD_LINK_REMOVE_RE = /idx-dead-link-remove|remove dead internal link|auto-fixable.*remove.*dead/i
const SITEMAP_DRIFT_RE = /idx-sitemap-drift|sitemap out of date|sitemap-regenerate/i
const MISSING_PAGE_RE = /idx-dead-page-|missing-page-content|destination page missing/i

/** Site-wide / multi-file fixes — require server/CMS write access. */
const SERVER_AUTO_KINDS = new Set<AutoFixKind>([
  'security-headers',
  'llms-txt',
  'redirect-canonical',
  'remove-dead-link',
  'sitemap-regenerate',
])

const SERVER_REQUIRED_HINT =
  'Requires server access — connect via WordPress/Shopify/GitHub to auto-fix, or fix manually in hosting config.'

function demoteForConnection(
  classified: ClassifiedIssue,
  connectionType?: string | null,
): ClassifiedIssue {
  if (!classified.autoKind || classified.fixability !== 'auto') return classified

  // No connection context: keep structural DOM fixes; demote header/file kinds
  // so we never overpromise when the UI doesn't know the connector yet.
  if (!connectionType) {
    if (classified.autoKind && SERVER_AUTO_KINDS.has(classified.autoKind)) {
      return {
        ...classified,
        fixability: 'human',
        humanKind: 'requires-server',
        autoKind: undefined,
        reason: 'Needs a server/CMS connection to apply this fix safely.',
        fixPathHint: SERVER_REQUIRED_HINT,
      }
    }
    return classified
  }

  if (isServerCmsConnection(connectionType)) return classified

  // Universal Tag (or unknown non-CMS): only post-load DOM fixes
  if (!UNIVERSAL_TAG_SAFE_AUTO_KINDS.has(classified.autoKind)) {
    return {
      ...classified,
      fixability: 'human',
      humanKind: 'requires-server',
      autoKind: undefined,
      reason:
        classified.autoKind === 'security-headers'
          ? 'HTTP headers are set server-side before any JavaScript runs — a Universal Tag cannot change them.'
          : 'This fix needs server/CMS write access (static file or host config), not a client-side tag.',
      fixPathHint: SERVER_REQUIRED_HINT,
    }
  }

  return classified
}

export function classifyAuditIssue(
  issue: PageAuditIssue,
  options?: ClassifyOptions,
): ClassifiedIssue {
  const hay = `${issue.id} ${issue.title} ${issue.description} ${issue.category}`
  const connectionType = options?.connectionType

  let base: ClassifiedIssue

  if (issue.fixMetadata?.kind === 'missing-page-content') {
    base = {
      issue,
      fixability: 'human',
      humanKind: 'missing-page-content',
      reason: 'Recreating a missing page requires real legal/business content — never auto-generated.',
    }
  } else if (issue.fixMetadata?.kind === 'redirect-canonical' || REDIRECT_CANONICAL_RE.test(hay)) {
    base = {
      issue,
      fixability: 'auto',
      autoKind: 'redirect-canonical',
      reason: 'Mechanical 301 redirect from crawl-derived canonical mismatch evidence.',
    }
  } else if (issue.fixMetadata?.kind === 'remove-dead-link' || DEAD_LINK_REMOVE_RE.test(hay)) {
    base = {
      issue,
      fixability: 'auto',
      autoKind: 'remove-dead-link',
      reason: 'Mechanical removal of dead <a href> on source page(s) — does not recreate destination content.',
    }
  } else if (issue.fixMetadata?.kind === 'sitemap-regenerate' || SITEMAP_DRIFT_RE.test(hay)) {
    base = {
      issue,
      fixability: 'auto',
      autoKind: 'sitemap-regenerate',
      reason: 'Regenerate sitemap.xml from INDEXABLE crawl URLs and commit to site.',
    }
  } else if (MISSING_PAGE_RE.test(hay)) {
    base = {
      issue,
      fixability: 'human',
      humanKind: 'missing-page-content',
      reason: 'The destination page needs real content — not auto-invented.',
    }
  } else if (THIN_RE.test(hay) || /ecom-description-thin|ecom-category-thin|ecom-description-placeholder/i.test(issue.id)) {
    base = {
      issue,
      fixability: 'human',
      humanKind: 'thin-content',
      reason: 'Thin/placeholder content needs a human-written brief — never auto-published.',
    }
  } else if (INTERNAL_LINK_RE.test(hay) || /ecom-related-links/i.test(issue.id)) {
    base = {
      issue,
      fixability: 'human',
      humanKind: 'internal-linking',
      reason: 'Internal linking is an editorial/architecture decision.',
    }
  } else if (FACTUAL_RE.test(hay) || /ecom-availability-mismatch/i.test(issue.id)) {
    base = {
      issue,
      fixability: 'human',
      humanKind: 'factual-claim',
      reason: 'Requires a verified business/factual claim — not auto-fixed.',
    }
  } else if (META_TITLE_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'meta-title', reason: 'Structural meta title fix from existing page data.' }
  } else if (META_DESC_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'meta-description', reason: 'Structural meta description length/presence fix.' }
  } else if (H1_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'missing-h1', reason: 'Derive H1 from existing title/brand — no invented prose.' }
  } else if (SCHEMA_PRODUCT_RE.test(hay) || /ecom-product|ecom-offer/i.test(issue.id)) {
    base = { issue, fixability: 'auto', autoKind: 'schema-product', reason: 'Product JSON-LD from existing page fields.' }
  } else if (SCHEMA_BREADCRUMB_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'schema-breadcrumb', reason: 'BreadcrumbList from URL/nav structure.' }
  } else if (SCHEMA_ARTICLE_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'schema-article', reason: 'Article JSON-LD from existing title.' }
  } else if (SCHEMA_ORG_RE.test(hay) || (issue.category === 'schema' && /organization/i.test(hay))) {
    base = { issue, fixability: 'auto', autoKind: 'schema-organization', reason: 'Organization JSON-LD from site identity.' }
  } else if (issue.category === 'schema' && !/review|rating/i.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'schema-organization', reason: 'Generic schema gap — try Organization/Article inject.' }
  } else if (LANG_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'lang-attribute', reason: 'Add html lang from site market/default.' }
  } else if (ALT_RE.test(hay) || /ecom-image-alt/i.test(issue.id)) {
    base = { issue, fixability: 'auto', autoKind: 'image-alt', reason: 'Derive alt from filename; flag if insufficient.' }
  } else if (LLMS_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'llms-txt', reason: 'Create static llms.txt.' }
  } else if (HTML_STRUCT_RE.test(hay)) {
    base = { issue, fixability: 'auto', autoKind: 'html-structure', reason: 'Strip stray document-wrapper tags.' }
  } else if (SECURITY_RE.test(hay)) {
    base = {
      issue,
      fixability: 'auto',
      autoKind: 'security-headers',
      reason: 'Platform/header config when adapter supports it.',
    }
  } else if (issue.severity === 'info') {
    base = { issue, fixability: 'skip', reason: 'Informational finding — no automatic action.' }
  } else {
    base = {
      issue,
      fixability: 'human',
      humanKind: 'other-editorial',
      reason: 'Not classified as a safe structural auto-fix.',
    }
  }

  return demoteForConnection(base, connectionType)
}

export function classifyAuditIssues(
  issues: PageAuditIssue[],
  options?: ClassifyOptions,
): ClassifiedIssue[] {
  return issues.map((issue) => classifyAuditIssue(issue, options))
}

/** Annotate audit issues with connection-aware fix-path copy for the report UI. */
export function annotateIssuesWithFixPath(
  issues: PageAuditIssue[],
  connectionType?: string | null,
): Array<PageAuditIssue & { fixability: Fixability; fixPathHint?: string; autoKind?: AutoFixKind }> {
  return issues.map((issue) => {
    const c = classifyAuditIssue(issue, { connectionType })
    return {
      ...issue,
      fixability: c.fixability,
      autoKind: c.autoKind,
      fixPathHint: c.fixPathHint,
      remediation:
        c.fixPathHint && (!issue.remediation || SECURITY_RE.test(`${issue.title} ${issue.description}`))
          ? c.fixPathHint
          : issue.remediation,
    }
  })
}
