/**
 * E-commerce-specific audit checks — run in addition to the general
 * Quality Gate / site-audit dimensions when site-type detection says ecommerce.
 */

import type { SiteTypeDetection } from './site-type-detector'

export interface EcommerceAuditIssue {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: 'ecommerce'
  title: string
  description: string
  remediation: string
  /** Maps into explainable score dimensions. */
  affectsDimensions: Array<
    'technical_seo' | 'structured_data' | 'factual_verification' | 'readability' | 'internal_linking' | 'editorial'
  >
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]))
    } catch {
      /* ignore invalid JSON-LD */
    }
  }
  return blocks
}

function flattenNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node) return out
  if (Array.isArray(node)) {
    for (const n of node) flattenNodes(n, out)
    return out
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    out.push(obj)
    if (obj['@graph']) flattenNodes(obj['@graph'], out)
    if (obj.mainEntity) flattenNodes(obj.mainEntity, out)
  }
  return out
}

function findProductNodes(html: string): Record<string, unknown>[] {
  const all = flattenNodes(extractJsonLdBlocks(html))
  return all.filter((n) => {
    const t = n['@type']
    if (typeof t === 'string') return t.toLowerCase() === 'product'
    if (Array.isArray(t)) return t.some((x) => String(x).toLowerCase() === 'product')
    return false
  })
}

function offerFromProduct(product: Record<string, unknown>): Record<string, unknown> | null {
  const offers = product.offers
  if (!offers) return null
  if (Array.isArray(offers)) return (offers[0] as Record<string, unknown>) || null
  if (typeof offers === 'object') return offers as Record<string, unknown>
  return null
}

export function runEcommerceAuditChecks(
  html: string,
  url: string,
  detection: SiteTypeDetection,
): EcommerceAuditIssue[] {
  if (detection.siteType !== 'ecommerce') return []

  const issues: EcommerceAuditIssue[] = []
  const products = findProductNodes(html)
  const isProductPage = detection.pageRole === 'product' || products.length > 0
  const isCategoryPage = detection.pageRole === 'category'

  // Product schema completeness
  if (isProductPage) {
    if (products.length === 0) {
      issues.push({
        id: 'ecom-product-schema-missing',
        severity: 'critical',
        category: 'ecommerce',
        title: 'Product schema missing',
        description: 'This looks like a product page but no schema.org/Product JSON-LD was found.',
        remediation: 'Add Product JSON-LD with name, image, description, offers (price, priceCurrency, availability), and brand.',
        affectsDimensions: ['structured_data'],
      })
    } else {
      const p = products[0]
      const required = ['name', 'description', 'image'] as const
      for (const field of required) {
        if (!p[field]) {
          issues.push({
            id: `ecom-product-missing-${field}`,
            severity: 'warning',
            category: 'ecommerce',
            title: `Product schema missing ${field}`,
            description: `Product JSON-LD is present but "${field}" is empty or absent.`,
            remediation: `Populate Product.${field} with the real catalogue value — do not invent specs.`,
            affectsDimensions: ['structured_data'],
          })
        }
      }
      const offer = offerFromProduct(p)
      if (!offer) {
        issues.push({
          id: 'ecom-product-offers-missing',
          severity: 'critical',
          category: 'ecommerce',
          title: 'Product offers missing',
          description: 'Product schema has no offers block (price / availability).',
          remediation: 'Add Offer with price, priceCurrency, and availability from your live catalogue.',
          affectsDimensions: ['structured_data'],
        })
      } else {
        for (const field of ['price', 'priceCurrency', 'availability'] as const) {
          if (!offer[field]) {
            issues.push({
              id: `ecom-offer-missing-${field}`,
              severity: 'warning',
              category: 'ecommerce',
              title: `Offer missing ${field}`,
              description: `Product offers block is incomplete — "${field}" is missing.`,
              remediation: `Set offers.${field} from live catalogue data.`,
              affectsDimensions: ['structured_data'],
            })
          }
        }
      }
      if (!p.brand) {
        issues.push({
          id: 'ecom-product-brand-missing',
          severity: 'info',
          category: 'ecommerce',
          title: 'Product brand missing',
          description: 'Product schema has no brand.',
          remediation: 'Add brand (Organization or Text) matching the catalogue.',
          affectsDimensions: ['structured_data'],
        })
      }
      if (!p.sku && !p.gtin && !p.gtin13 && !p.gtin14 && !p.mpn) {
        issues.push({
          id: 'ecom-product-id-missing',
          severity: 'info',
          category: 'ecommerce',
          title: 'No SKU / GTIN / MPN',
          description: 'Product schema lacks a product identifier (sku, gtin, or mpn).',
          remediation: 'Add at least one real product identifier from your catalogue.',
          affectsDimensions: ['structured_data'],
        })
      }
    }
  }

  // Description uniqueness heuristic — duplicated manufacturer boilerplate
  if (isProductPage) {
    const desc =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ||
      html.match(/itemprop=["']description["'][^>]*>([\s\S]*?)</i)?.[1] ||
      ''
    const plain = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (plain.length > 0 && plain.length < 80) {
      issues.push({
        id: 'ecom-description-thin',
        severity: 'warning',
        category: 'ecommerce',
        title: 'Thin product description',
        description: 'Product description / meta looks shorter than ~80 characters — often a duplicated manufacturer blurb.',
        remediation: 'Write a unique description covering use-cases and differentiators (no invented specs or prices).',
        affectsDimensions: ['editorial', 'readability'],
      })
    }
    if (/\b(lorem ipsum|placeholder|product description goes here)\b/i.test(html)) {
      issues.push({
        id: 'ecom-description-placeholder',
        severity: 'critical',
        category: 'ecommerce',
        title: 'Placeholder product copy',
        description: 'Page contains placeholder manufacturer/boilerplate text.',
        remediation: 'Replace placeholders with unique product copy.',
        affectsDimensions: ['editorial'],
      })
    }
  }

  // Category / collection pages
  if (isCategoryPage) {
    const wordish = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
    const words = wordish.split(/\s+/).filter(Boolean).length
    const hasH1 = /<h1\b/i.test(html)
    if (words < 150) {
      issues.push({
        id: 'ecom-category-thin-copy',
        severity: 'warning',
        category: 'ecommerce',
        title: 'Category page lacks indexable copy',
        description: `Category/collection page has ~${words} words of visible text — often just a product grid.`,
        remediation: 'Add a unique intro (guidance-level) plus clear H1/H2 structure; avoid inventing prices or stock claims.',
        affectsDimensions: ['editorial', 'readability'],
      })
    }
    if (!hasH1) {
      issues.push({
        id: 'ecom-category-missing-h1',
        severity: 'warning',
        category: 'ecommerce',
        title: 'Category page missing H1',
        description: 'No H1 found on a category/collection URL.',
        remediation: 'Add one clear H1 describing the collection.',
        affectsDimensions: ['technical_seo'],
      })
    }
  }

  // Title / meta templating smell (very short or generic)
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || ''
  if (isProductPage && (/^product\b/i.test(title) || title.length < 12)) {
    issues.push({
      id: 'ecom-title-templated',
      severity: 'warning',
      category: 'ecommerce',
      title: 'Weak / templated product title',
      description: `Title "${title.slice(0, 80)}" looks generic or templated.`,
      remediation: 'Use a unique title pattern with product name + differentiating attribute (no invented claims).',
      affectsDimensions: ['technical_seo'],
    })
  }

  // Product image alt text
  const imgTags = html.match(/<img\b[^>]*>/gi) || []
  const productishImgs = imgTags.filter((t) => /product|cdn\.shopify|woocommerce|catalog/i.test(t) || /itemprop=["']image["']/i.test(t))
  const missingAlt = (productishImgs.length ? productishImgs : imgTags.slice(0, 12)).filter(
    (t) => !/\balt\s*=\s*["'][^"']+["']/i.test(t),
  )
  if (missingAlt.length >= 2) {
    issues.push({
      id: 'ecom-image-alt-missing',
      severity: 'warning',
      category: 'ecommerce',
      title: `Product images missing alt text (${missingAlt.length})`,
      description: 'Multiple product-related images lack meaningful alt attributes.',
      remediation: 'Add descriptive alt text naming the product/variant — not keyword stuffing.',
      affectsDimensions: ['technical_seo', 'readability'],
    })
  }

  // Breadcrumb schema
  if (!/"@type"\s*:\s*"BreadcrumbList"/i.test(html)) {
    issues.push({
      id: 'ecom-breadcrumb-schema-missing',
      severity: 'info',
      category: 'ecommerce',
      title: 'BreadcrumbList schema missing',
      description: 'No BreadcrumbList JSON-LD detected.',
      remediation: 'Add BreadcrumbList matching the visible breadcrumb trail.',
      affectsDimensions: ['structured_data'],
    })
  }

  // Out of stock / availability honesty
  if (isProductPage) {
    const offer = products[0] ? offerFromProduct(products[0]) : null
    const avail = String(offer?.availability || '')
    const pageSaysOos = /\b(out of stock|sold out|unavailable)\b/i.test(html)
    if (pageSaysOos && /InStock/i.test(avail)) {
      issues.push({
        id: 'ecom-availability-mismatch',
        severity: 'critical',
        category: 'ecommerce',
        title: 'Availability schema mismatch',
        description: 'Page copy says out of stock but Offer.availability still claims InStock.',
        remediation: 'Sync Offer.availability with live inventory (OutOfStock) or return 404/410 for discontinued SKUs.',
        affectsDimensions: ['structured_data', 'factual_verification'],
      })
    }
  }

  // Related product internal links
  if (isProductPage) {
    const related = /\b(related products|you may also like|customers also bought|similar items)\b/i.test(html)
    if (!related) {
      issues.push({
        id: 'ecom-related-links-missing',
        severity: 'info',
        category: 'ecommerce',
        title: 'No related-product linking block detected',
        description: 'Could not find a related / complementary products section.',
        remediation: 'Add internal links between complementary products with descriptive anchors.',
        affectsDimensions: ['internal_linking'],
      })
    }
  }

  // Review schema
  if (isProductPage && products.length > 0) {
    const p = products[0]
    if (!p.aggregateRating && !p.review) {
      issues.push({
        id: 'ecom-review-schema-missing',
        severity: 'info',
        category: 'ecommerce',
        title: 'No review / aggregateRating schema',
        description: 'Product schema has neither aggregateRating nor review.',
        remediation: 'When real reviews exist, expose aggregateRating/review in Product schema — never invent ratings.',
        affectsDimensions: ['structured_data'],
      })
    }
  }

  void url
  return issues
}
