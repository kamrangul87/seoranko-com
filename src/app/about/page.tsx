import type { Metadata } from 'next'
import { MarketingPage } from '@/components/MarketingPage'
import { ABOUT_COPY } from '@/lib/about-copy'
import { ABOUT_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = ABOUT_METADATA

export default function AboutPage() {
  return (
    <MarketingPage>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '72px 24px 96px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1.15, marginBottom: 16 }}>
          {ABOUT_COPY.title}
        </h1>
        <p style={{ fontSize: 18, color: '#333', lineHeight: 1.65, marginBottom: 16 }}>{ABOUT_COPY.lede}</p>
        <p style={{ fontSize: 16, color: '#6B6B6B', lineHeight: 1.65, marginBottom: 48 }}>
          {ABOUT_COPY.founderLine}
        </p>

        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', marginBottom: 20 }}>
          {ABOUT_COPY.whatTitle}
        </h2>
        <div style={{ display: 'grid', gap: 20, marginBottom: 48 }}>
          {ABOUT_COPY.what.map((item) => (
            <section
              key={item.title}
              style={{
                background: '#fff',
                border: '1px solid #E8E8E4',
                borderRadius: 12,
                padding: 24,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{item.title}</h3>
              <p style={{ fontSize: 15, color: '#6B6B6B', lineHeight: 1.65, margin: 0 }}>{item.body}</p>
            </section>
          ))}
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', marginBottom: 12 }}>
          {ABOUT_COPY.whoTitle}
        </h2>
        <p style={{ fontSize: 16, color: '#333', lineHeight: 1.65, marginBottom: 40 }}>{ABOUT_COPY.who}</p>

        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', marginBottom: 12 }}>
          {ABOUT_COPY.approachTitle}
        </h2>
        <p style={{ fontSize: 16, color: '#333', lineHeight: 1.65, margin: 0 }}>{ABOUT_COPY.approach}</p>
      </main>
    </MarketingPage>
  )
}
