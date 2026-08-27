/**
 * Detect whether a crawled page/site is e-commerce vs content/blog.
 * Pattern-based — no hard-coded brand or market assumptions.
 */

export type SiteType = 'ecommerce' | 'content' | 'unknown'

export interface SiteTypeDetection {
  siteType: SiteType
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
  /** Likely page role when e-commerce. */
  pageRole: 'product' | 'category' | 'other' | null
}

const PLATFORM_RE =
  /\b(shopify|woocommerce|mage\/cookies|magento|bigcommerce|shopify-section|wc-add-to-cart|data-product-id)\b/i

const BUY_CTA_RE =
  /\b(add to (?:cart|bag|basket)|buy now|add to bag|purchase now|checkout)\b/i

const PRICE_EL_RE =
  /itemprop=["']price["']|["']priceCurrency["']|class=["'][^"']*price[^"']*["']|data-price=|\$\s?\d|\£\s?\d|€\s?\d/i

const VARIANT_RE =
  /\b(product-variant|variant-select|swatch|choose (?:size|colour|color)|data-variant)\b/i

const PRODUCT_SCHEMA_RE = /"@type"\s*:\s*"Product"/i
const COLLECTION_SCHEMA_RE = /"@type"\s*:\s*"(?:CollectionPage|OfferCatalog)"/i
const CATEGORY_PATH_RE = /\/(collections?|categor(?:y|ies)|shop|products?|catalog)\b/i

export function detectSiteType(html: string, url: string): SiteTypeDetection {
  const signals: string[] = []
  let score = 0

  if (PRODUCT_SCHEMA_RE.test(html)) {
    signals.push('Product JSON-LD')
    score += 3
  }
  if (PLATFORM_RE.test(html)) {
    signals.push('e-commerce platform signature')
    score += 3
  }
  if (BUY_CTA_RE.test(html)) {
    signals.push('buy/add-to-cart CTA')
    score += 2
  }
  if (PRICE_EL_RE.test(html)) {
    signals.push('price markup')
    score += 2
  }
  if (VARIANT_RE.test(html)) {
    signals.push('product variant UI')
    score += 1
  }
  if (COLLECTION_SCHEMA_RE.test(html) || CATEGORY_PATH_RE.test(url)) {
    signals.push('category/collection cues')
    score += 1
  }

  let pageRole: SiteTypeDetection['pageRole'] = null
  if (PRODUCT_SCHEMA_RE.test(html) || /\/products?\//i.test(url)) pageRole = 'product'
  else if (COLLECTION_SCHEMA_RE.test(html) || CATEGORY_PATH_RE.test(url)) pageRole = 'category'
  else if (score >= 3) pageRole = 'other'

  if (score >= 5) {
    return { siteType: 'ecommerce', confidence: 'high', signals, pageRole }
  }
  if (score >= 3) {
    return { siteType: 'ecommerce', confidence: 'medium', signals, pageRole }
  }
  if (score >= 1) {
    return { siteType: 'ecommerce', confidence: 'low', signals, pageRole }
  }

  // Content cues
  const contentSignals: string[] = []
  if (/"@type"\s*:\s*"Article"/i.test(html)) contentSignals.push('Article schema')
  if (/<article\b/i.test(html)) contentSignals.push('<article> landmark')
  if (/\b(blog|posted on|written by|minutes read)\b/i.test(html)) contentSignals.push('blog cues')

  if (contentSignals.length > 0) {
    return {
      siteType: 'content',
      confidence: contentSignals.length >= 2 ? 'high' : 'medium',
      signals: contentSignals,
      pageRole: null,
    }
  }

  return { siteType: 'unknown', confidence: 'low', signals: [], pageRole: null }
}
