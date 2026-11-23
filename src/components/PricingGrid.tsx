import Link from 'next/link'
import { HOMEPAGE_COPY } from '@/lib/homepage-copy'
import {
  PAID_ONLY_FEATURES,
  SEORANKO_FREE_PLAN,
  SEORANKO_PLANS,
} from '@/lib/stripe/plans'

const ctaBase = {
  display: 'block' as const,
  textAlign: 'center' as const,
  padding: 10,
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none' as const,
}

export function PricingGrid() {
  const c = HOMEPAGE_COPY
  return (
    <>
      <style>{`
        .hp-pricing { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: stretch; }
        .hp-price-card { display: flex; flex-direction: column; height: 100%; border-radius: 12px; padding: 24px; background: #fff; position: relative; }
        .hp-price-cta { margin-top: auto; }
        @media (max-width: 900px) {
          .hp-pricing { grid-template-columns: 1fr; }
        }
      `}</style>
      <div className="hp-pricing">
        <div className="hp-price-card" style={{ border: '1px solid #E8E8E4' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9B9B9B', letterSpacing: '1px', marginBottom: 6 }}>
            {SEORANKO_FREE_PLAN.label.toUpperCase()}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px', marginBottom: 2 }}>
            {SEORANKO_FREE_PLAN.priceDisplay}
          </div>
          <div style={{ fontSize: 12, color: '#9B9B9B', marginBottom: 16 }}>{SEORANKO_FREE_PLAN.tagline}</div>
          <div style={{ borderTop: '1px solid #E8E8E4', paddingTop: 16, marginBottom: 20, flex: 1 }}>
            {SEORANKO_FREE_PLAN.features.map((f) => (
              <div key={f} style={{ fontSize: 12, color: '#444', padding: '4px 0', display: 'flex', gap: 7 }}>
                <span style={{ color: '#16A34A', fontWeight: 700, flexShrink: 0 }}>✓</span>
                {f}
              </div>
            ))}
          </div>
          <Link
            href="/signup"
            className="hp-price-cta"
            data-pricing-cta="true"
            style={{
              ...ctaBase,
              background: 'transparent',
              color: '#333',
              border: '1.5px solid #E8E8E4',
            }}
          >
            Start free
          </Link>
        </div>

        {Object.values(SEORANKO_PLANS).map((p, i) => {
          const featured = i === 1
          return (
            <div
              key={p.id}
              className="hp-price-card"
              style={{ border: featured ? '2px solid #FF6B2C' : '1px solid #E8E8E4' }}
            >
              {featured && (
                <div
                  style={{
                    position: 'absolute',
                    top: -12,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#FF6B2C',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '3px 12px',
                    borderRadius: 20,
                    whiteSpace: 'nowrap',
                  }}
                >
                  MOST POPULAR
                </div>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9B9B9B', letterSpacing: '1px', marginBottom: 6 }}>
                {p.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px', marginBottom: 2 }}>
                {p.priceDisplay.replace('/mo', '')}
                <span style={{ fontSize: 14, fontWeight: 400, color: '#9B9B9B' }}>/mo</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F0F0F', marginBottom: 4 }}>
                {c.pricingPagesLine(p.pagesPerCrawlDisplay)}
              </div>
              <div style={{ fontSize: 12, color: '#9B9B9B', marginBottom: 16 }}>{p.tagline}</div>
              <div style={{ borderTop: '1px solid #E8E8E4', paddingTop: 16, marginBottom: 20, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B', marginBottom: 8 }}>
                  {c.pricingEverythingInFree}
                </div>
                {PAID_ONLY_FEATURES.map((f) => (
                  <div key={f} style={{ fontSize: 12, color: '#444', padding: '4px 0', display: 'flex', gap: 7 }}>
                    <span style={{ color: '#16A34A', fontWeight: 700, flexShrink: 0 }}>✓</span>
                    {f}
                  </div>
                ))}
              </div>
              <Link
                href="/signup"
                className="hp-price-cta"
                data-pricing-cta="true"
                style={{
                  ...ctaBase,
                  background: featured ? '#FF6B2C' : 'transparent',
                  color: featured ? '#fff' : '#333',
                  border: featured ? 'none' : '1.5px solid #E8E8E4',
                }}
              >
                Get started
              </Link>
            </div>
          )
        })}
      </div>
    </>
  )
}
