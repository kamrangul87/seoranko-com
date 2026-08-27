/**
 * SEO copilot pivot — site-type detection, ecommerce checks, brief constraints.
 */

import { describe, it, expect } from 'vitest'
import { detectSiteType } from './site-type-detector'
import { runEcommerceAuditChecks } from './ecommerce-audit-checks'
import {
  generateContentBrief,
  briefContainsInventedClaims,
} from './content-brief-generator'
import { buildExplainableScore } from './quality-score-dimensions'

describe('site-type detection', () => {
  it('detects ecommerce product pages via Product schema + CTA', () => {
    const html = `
      <html><body>
      <script type="application/ld+json">{"@type":"Product","name":"Widget","offers":{"@type":"Offer","price":"10","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>
      <button>Add to cart</button>
      <span class="price">$10</span>
      </body></html>`
    const d = detectSiteType(html, 'https://shop.example.com/products/widget')
    expect(d.siteType).toBe('ecommerce')
    expect(d.pageRole).toBe('product')
    expect(d.signals.length).toBeGreaterThan(0)
  })

  it('detects content/blog pages via Article schema', () => {
    const html = `
      <html><body><article>
      <script type="application/ld+json">{"@type":"Article","headline":"Guide"}</script>
      <p>Written by someone. Posted on a blog.</p>
      </article></body></html>`
    const d = detectSiteType(html, 'https://example.com/blog/guide')
    expect(d.siteType).toBe('content')
  })
})

describe('ecommerce audit checks', () => {
  it('flags missing Product schema on product-like pages', () => {
    const detection = detectSiteType(
      '<html><body><button>Buy now</button><div class="price">£20</div></body></html>',
      'https://shop.example.com/products/x',
    )
    const issues = runEcommerceAuditChecks(
      '<html><body><button>Buy now</button><div class="price">£20</div><h1>X</h1></body></html>',
      'https://shop.example.com/products/x',
      detection,
    )
    expect(issues.some((i) => i.id === 'ecom-product-schema-missing' || i.category === 'ecommerce')).toBe(
      true,
    )
  })

  it('flags incomplete Product offers', () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"Product","name":"X","description":"Y","image":"https://cdn.example.com/x.jpg"}</script>
      <button>Add to cart</button>
    </body></html>`
    const detection = detectSiteType(html, 'https://shop.example.com/products/x')
    const issues = runEcommerceAuditChecks(html, 'https://shop.example.com/products/x', detection)
    expect(issues.some((i) => i.id === 'ecom-product-offers-missing')).toBe(true)
  })

  it('maps ecommerce issues into explainable dimensions', () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"Product","name":"X"}</script>
      <button>Add to cart</button>
    </body></html>`
    const detection = detectSiteType(html, 'https://shop.example.com/products/x')
    const issues = runEcommerceAuditChecks(html, 'https://shop.example.com/products/x', detection)
    const explainable = buildExplainableScore(
      issues.map((i) => ({
        id: i.id,
        severity: i.severity,
        category: i.category,
        title: i.title,
        affectsDimensions: i.affectsDimensions,
      })),
    )
    expect(explainable.dimensions.some((d) => d.id === 'structured_data')).toBe(true)
  })
})

describe('content brief — no invented facts', () => {
  it('fallback content brief has no invented £/%/stock claims', async () => {
    const brief = await generateContentBrief({ seedKeyword: 'ev charger grant', mode: 'content' })
    expect(brief.sections.length).toBeGreaterThan(2)
    expect(briefContainsInventedClaims(brief)).toBe(false)
    expect(brief.sections.some((s) => s.needsCitation)).toBe(true)
  })

  it('product brief never invents price or stock', async () => {
    const brief = await generateContentBrief({
      seedKeyword: 'buy titanium water bottle',
      mode: 'product',
    })
    expect(brief.mode).toBe('product')
    expect(briefContainsInventedClaims(brief)).toBe(false)
    const blob = JSON.stringify(brief)
    expect(blob).not.toMatch(/£\d|\$\d|in stock|out of stock/i)
  })

  it('category brief stays guidance-only', async () => {
    const brief = await generateContentBrief({
      seedKeyword: 'best hiking jackets',
      mode: 'category',
    })
    expect(brief.mode).toBe('category')
    expect(briefContainsInventedClaims(brief)).toBe(false)
  })
})
