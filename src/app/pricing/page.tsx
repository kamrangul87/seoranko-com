import type { Metadata } from 'next'
import { MarketingPage } from '@/components/MarketingPage'
import { PricingGrid } from '@/components/PricingGrid'
import { HOMEPAGE_COPY } from '@/lib/homepage-copy'
import { PRICING_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = PRICING_METADATA

export default function PricingPage() {
  const c = HOMEPAGE_COPY
  return (
    <MarketingPage>
      <section style={{ maxWidth: 1040, margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#FF6B2C',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            {c.pricingEyebrow}
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1px', marginBottom: 10 }}>
            {c.pricingTitle}
          </h1>
          <p style={{ fontSize: 15, color: '#6B6B6B', marginBottom: 12 }}>{c.pricingSubtitle}</p>
          <p style={{ fontSize: 14, color: '#6B6B6B', maxWidth: 560, margin: '0 auto' }}>
            {c.pricingPaidPlansDiffer}
          </p>
        </div>
        <PricingGrid />
      </section>
    </MarketingPage>
  )
}
