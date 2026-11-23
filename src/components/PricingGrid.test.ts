import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PricingGrid } from '@/components/PricingGrid'
import { SEORANKO_FREE_PLAN, SEORANKO_PLANS } from '@/lib/stripe/plans'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children?: ReactNode
    style?: React.CSSProperties
  }) => createElement('a', { href, ...rest }, children),
}))

describe('PricingGrid', () => {
  it('renders plan labels and prices from SEORANKO_PLANS without inventing features', () => {
    const html = renderToStaticMarkup(createElement(PricingGrid))
    expect(html).toContain(SEORANKO_FREE_PLAN.label.toUpperCase())
    expect(html).toContain(SEORANKO_FREE_PLAN.priceDisplay)
    expect(html).toContain('25 pages')
    for (const plan of Object.values(SEORANKO_PLANS)) {
      expect(html).toContain(plan.label.toUpperCase())
      expect(html).toContain(plan.priceDisplay.replace('/mo', ''))
      expect(html).toContain(`${plan.pagesPerCrawlDisplay} pages per crawl`)
    }
    expect(SEORANKO_PLANS.seoranko_starter.priceDisplay).toBe('£29/mo')
    expect(SEORANKO_PLANS.seoranko_pro.priceDisplay).toBe('£79/mo')
    expect(SEORANKO_PLANS.seoranko_agency.priceDisplay).toBe('£149/mo')
    const proFeatures = SEORANKO_PLANS.seoranko_pro.features.slice(1).join('\n')
    const agencyFeatures = SEORANKO_PLANS.seoranko_agency.features.slice(1).join('\n')
    expect(proFeatures).toBe(agencyFeatures)
  })
})
