/**
 * Classify Site Audit issues as auto-fixable vs human-guided.
 * Thin content / internal linking / factual claims NEVER auto-fix.
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

export type HumanFixKind = 'thin-content' | 'internal-linking' | 'factual-claim' | 'other-editorial'

export interface ClassifiedIssue {
  issue: PageAuditIssue
  fixability: Fixability
  autoKind?: AutoFixKind
  humanKind?: HumanFixKind
  reason: string
}

const THIN_RE = /thin content|low word count|lacks indexable copy|thin product description|placeholder product/i
const INTERNAL_LINK_RE = /internal link|related-product linking|orphan|link strategy/i
const FACTUAL_RE = /availability mismatch|pricing|stock claim|policy statement|invent/i

const META_TITLE_RE = /title tag|meta title|weak \/ templated product title|missing title/i
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

export function classifyAuditIssue(issue: PageAuditIssue): ClassifiedIssue {
  const hay = `${issue.id} ${issue.title} ${issue.description} ${issue.category}`

  if (THIN_RE.test(hay) || /ecom-description-thin|ecom-category-thin|ecom-description-placeholder/i.test(issue.id)) {
    return {
      issue,
      fixability: 'human',
      humanKind: 'thin-content',
      reason: 'Thin/placeholder content needs a human-written brief — never auto-published.',
    }
  }
  if (INTERNAL_LINK_RE.test(hay) || /ecom-related-links/i.test(issue.id)) {
    return {
      issue,
      fixability: 'human',
      humanKind: 'internal-linking',
      reason: 'Internal linking is an editorial/architecture decision.',
    }
  }
  if (FACTUAL_RE.test(hay) || /ecom-availability-mismatch/i.test(issue.id)) {
    return {
      issue,
      fixability: 'human',
      humanKind: 'factual-claim',
      reason: 'Requires a verified business/factual claim — not auto-fixed.',
    }
  }

  if (META_TITLE_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'meta-title', reason: 'Structural meta title fix from existing page data.' }
  }
  if (META_DESC_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'meta-description', reason: 'Structural meta description length/presence fix.' }
  }
  if (H1_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'missing-h1', reason: 'Derive H1 from existing title/brand — no invented prose.' }
  }
  if (SCHEMA_PRODUCT_RE.test(hay) || /ecom-product|ecom-offer/i.test(issue.id)) {
    return { issue, fixability: 'auto', autoKind: 'schema-product', reason: 'Product JSON-LD from existing page fields.' }
  }
  if (SCHEMA_BREADCRUMB_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'schema-breadcrumb', reason: 'BreadcrumbList from URL/nav structure.' }
  }
  if (SCHEMA_ARTICLE_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'schema-article', reason: 'Article JSON-LD from existing title.' }
  }
  if (SCHEMA_ORG_RE.test(hay) || (issue.category === 'schema' && /organization/i.test(hay))) {
    return { issue, fixability: 'auto', autoKind: 'schema-organization', reason: 'Organization JSON-LD from site identity.' }
  }
  if (issue.category === 'schema' && !/review|rating/i.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'schema-organization', reason: 'Generic schema gap — try Organization/Article inject.' }
  }
  if (LANG_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'lang-attribute', reason: 'Add html lang from site market/default.' }
  }
  if (ALT_RE.test(hay) || /ecom-image-alt/i.test(issue.id)) {
    return { issue, fixability: 'auto', autoKind: 'image-alt', reason: 'Derive alt from filename; flag if insufficient.' }
  }
  if (LLMS_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'llms-txt', reason: 'Create static llms.txt.' }
  }
  if (HTML_STRUCT_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'html-structure', reason: 'Strip stray document-wrapper tags.' }
  }
  if (SECURITY_RE.test(hay)) {
    return { issue, fixability: 'auto', autoKind: 'security-headers', reason: 'Platform/header config when adapter supports it.' }
  }

  // Default: human review for unknown editorial issues; skip notices that are informational only
  if (issue.severity === 'info') {
    return { issue, fixability: 'skip', reason: 'Informational finding — no automatic action.' }
  }

  return {
    issue,
    fixability: 'human',
    humanKind: 'other-editorial',
    reason: 'Not classified as a safe structural auto-fix.',
  }
}

export function classifyAuditIssues(issues: PageAuditIssue[]): ClassifiedIssue[] {
  return issues.map(classifyAuditIssue)
}
