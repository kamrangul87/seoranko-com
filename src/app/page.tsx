'use client'
import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CompanyFooter } from '@/components/CompanyFooter'
import { FeatureIcon } from '@/components/FeatureIcons'
import { SeorankoWordmark } from '@/components/SeorankoLogo'
import {
  SEORANKO_PLANS,
  SEORANKO_FREE_PLAN,
  PAID_ONLY_FEATURES,
} from '@/lib/stripe/plans'
import { HOMEPAGE_COPY } from '@/lib/homepage-copy'
import {
  PROOF_EXAMPLES,
  PROOF_PR_BASE_URL,
  PROOF_SITE_HOST,
  PROOF_UI_COPY,
  PROOF_VERIFIED_FIX_COUNT,
  HERO_LOOP_EXAMPLE,
  formatProofDate,
} from '@/lib/proof-examples'

function VerifiedPill() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: '#DCFCE7',
        color: '#166534',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: 20,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />
      {PROOF_UI_COPY.verifiedLivePill}
    </span>
  )
}

export default function LandingPage() {
  const c = HOMEPAGE_COPY
  const router = useRouter()
  const [checkDomain, setCheckDomain] = useState('')
  const loop = HERO_LOOP_EXAMPLE

  function onCheckSite(e: FormEvent) {
    e.preventDefault()
    const d = checkDomain.trim()
    if (!d) return
    router.push(`/tools/index-diagnosis?domain=${encodeURIComponent(d)}`)
  }

  return (
    <div style={{ fontFamily: "'Outfit', sans-serif", background: '#FAFAF8', color: '#0F0F0F', minHeight: '100vh' }}>
      <style>{`
        .hp-hero { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; max-width: 1100px; margin: 0 auto; padding: 72px 48px 64px; }
        .hp-hero-title { font-size: 42px; line-height: 1.15; font-weight: 800; color: #0F0F0F; letter-spacing: -1.4px; margin-bottom: 18px; text-wrap: balance; max-width: 16ch; }
        .hp-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .hp-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; }
        .hp-proof-table { display: grid; gap: 0; border: 1px solid #E8E8E4; border-radius: 12px; overflow: hidden; background: #fff; }
        .hp-proof-head, .hp-proof-row { display: grid; grid-template-columns: 1.2fr 1.4fr 0.9fr; gap: 16px; padding: 16px 20px; }
        .hp-proof-head { background: #F5F4F1; font-size: 11px; font-weight: 700; color: #6B6B6B; text-transform: uppercase; letter-spacing: 0.06em; }
        .hp-proof-row { border-top: 1px solid #E8E8E4; align-items: start; }
        .hp-pricing { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: stretch; }
        .hp-price-card { display: flex; flex-direction: column; height: 100%; border-radius: 12px; padding: 24px; background: #fff; position: relative; }
        .hp-price-cta { margin-top: auto; }
        .hp-nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 0 48px; height: 64px; }
        @media (max-width: 900px) {
          .hp-hero { grid-template-columns: 1fr; padding: 48px 24px 40px; gap: 36px; }
          .hp-hero-title { max-width: none; font-size: 34px; }
          .hp-features { grid-template-columns: 1fr; }
          .hp-steps { grid-template-columns: 1fr 1fr; }
          .hp-proof-head { display: none; }
          .hp-proof-row { grid-template-columns: 1fr; gap: 10px; }
          .hp-pricing { grid-template-columns: 1fr; }
          .hp-nav-inner { padding: 0 20px; }
        }
        @media (max-width: 560px) {
          .hp-steps { grid-template-columns: 1fr; }
        }
      `}</style>

      <nav style={{ background: '#fff', borderBottom: '1px solid #E8E8E4', position: 'sticky', top: 0, zIndex: 50 }}>
        <div className="hp-nav-inner">
          <Link href="/" style={{ textDecoration: 'none' }}>
            <SeorankoWordmark size={32} />
          </Link>
          <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
            {['Features', 'Pricing'].map((item) => (
              <a key={item} href={`#${item.toLowerCase()}`} style={{ fontSize: 14, color: '#6B6B6B', textDecoration: 'none' }}>
                {item}
              </a>
            ))}
            <Link href="/tools/index-diagnosis" style={{ fontSize: 14, color: '#6B6B6B', textDecoration: 'none' }}>
              {c.navFreeIndexCheck}
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link href="/login" style={{ fontSize: 13, color: '#333', textDecoration: 'none', padding: '7px 16px', border: '1px solid #E8E8E4', borderRadius: 7, background: '#fff' }}>
              Log in
            </Link>
            <Link href="/signup" style={{ fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '8px 18px', background: '#FF6B2C', borderRadius: 7 }}>
              Start free →
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hp-hero">
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: '#FFF0E8',
              border: '1px solid rgba(255,107,44,0.25)',
              color: '#CC4A0F',
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 14px',
              borderRadius: 20,
              marginBottom: 28,
            }}
          >
            <div style={{ width: 6, height: 6, background: '#FF6B2C', borderRadius: '50%' }} />
            {c.badge}
          </div>
          <h1 className="hp-hero-title">{c.heroTitle}</h1>
          <p style={{ fontSize: 17, color: '#6B6B6B', lineHeight: 1.65, maxWidth: 480, marginBottom: 28 }}>
            {c.heroSubtitle}
          </p>
          <div style={{ marginBottom: 12 }}>
            <Link
              href="/signup"
              style={{
                display: 'inline-block',
                fontSize: 15,
                fontWeight: 600,
                color: '#fff',
                textDecoration: 'none',
                padding: '14px 28px',
                background: '#FF6B2C',
                borderRadius: 8,
              }}
            >
              {c.heroCtaPrimary}
            </Link>
          </div>
          <p style={{ fontSize: 12, fontWeight: 500, color: '#9B9B9B', marginBottom: 8 }}>
            {c.heroCheckLabel}
          </p>
          <form
            onSubmit={onCheckSite}
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              alignItems: 'stretch',
              width: '100%',
              maxWidth: 420,
              marginBottom: 12,
            }}
          >
            <input
              type="text"
              value={checkDomain}
              onChange={(e) => setCheckDomain(e.target.value)}
              placeholder={c.heroCheckPlaceholder}
              aria-label={c.heroCheckPlaceholder}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                padding: '13px 14px',
                border: '1.5px solid #E8E8E4',
                borderRight: 'none',
                borderRadius: '8px 0 0 8px',
                background: '#fff',
                color: '#0F0F0F',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="submit"
              style={{
                flexShrink: 0,
                fontSize: 14,
                fontWeight: 600,
                color: '#333',
                padding: '13px 16px',
                background: '#fff',
                border: '1.5px solid #E8E8E4',
                borderRadius: '0 8px 8px 0',
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {c.heroCheckButton}
            </button>
          </form>
          <p style={{ fontSize: 13, color: '#9B9B9B' }}>{c.heroFootnote}</p>
        </div>

        {/* Loop card — real /blog canonical fix */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #E8E8E4',
            borderRadius: 16,
            boxShadow: '0 8px 28px rgba(0,0,0,0.06)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #E8E8E4', background: '#F5F4F1' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B6B6B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Fix loop · {PROOF_SITE_HOST}
            </div>
          </div>
          {[
            { label: PROOF_UI_COPY.loopFindingLabel, body: loop.problem },
            {
              label: PROOF_UI_COPY.loopFixLabel,
              body: (
                <span>
                  PR #{loop.prNumber} · {PROOF_UI_COPY.fixMergedLabel}
                </span>
              ),
            },
            {
              label: PROOF_UI_COPY.loopVerifiedLabel,
              body: (
                <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ wordBreak: 'break-all' }}>{loop.verifiedUrl}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <VerifiedPill />
                    <span style={{ fontSize: 12, color: '#9B9B9B' }}>{formatProofDate(loop.verifiedLiveOn)}</span>
                  </span>
                </span>
              ),
            },
          ].map((row, i) => (
            <div
              key={row.label}
              style={{
                padding: '16px 18px',
                borderTop: i === 0 ? undefined : '1px solid #E8E8E4',
                display: 'grid',
                gridTemplateColumns: '88px 1fr',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FF6B2C', letterSpacing: '0.04em', textTransform: 'uppercase', paddingTop: 2 }}>
                {row.label}
              </div>
              <div style={{ fontSize: 14, color: '#333', lineHeight: 1.5 }}>{row.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* TRUST BAR */}
      <div
        style={{
          borderTop: '1px solid #E8E8E4',
          borderBottom: '1px solid #E8E8E4',
          background: '#fff',
          padding: '14px 48px',
          display: 'flex',
          alignItems: 'center',
          gap: 40,
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        {c.trustBar.map((item) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#6B6B6B' }}>
            <span style={{ color: '#16A34A', fontWeight: 700 }}>✓</span> {item}
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <section id="features" style={{ maxWidth: 1040, margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 12 }}>
          {c.featuresEyebrow}
        </div>
        <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', marginBottom: 12, lineHeight: 1.15 }}>{c.featuresTitle}</h2>
        <p style={{ fontSize: 16, color: '#6B6B6B', maxWidth: 500, lineHeight: 1.65, marginBottom: 48 }}>{c.featuresSubtitle}</p>
        <div className="hp-features" data-testid="homepage-features">
          {c.features.map((f) => (
            <div
              key={f.title}
              style={{
                background: '#fff',
                border: '1px solid #E8E8E4',
                borderRadius: 12,
                padding: 24,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  background: '#FFF0E8',
                  borderRadius: 9,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 14,
                }}
              >
                <FeatureIcon name={f.icon} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: '#6B6B6B', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <div style={{ background: '#fff', borderTop: '1px solid #E8E8E4', borderBottom: '1px solid #E8E8E4' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '72px 48px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 12 }}>
            {c.howItWorksEyebrow}
          </div>
          <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1px', marginBottom: 48 }}>{c.howItWorksTitle}</h2>
          <div className="hp-steps">
            {c.howItWorksSteps.map((s) => (
              <div key={s.num} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    border: '2px solid #FF6B2C',
                    color: '#FF6B2C',
                    fontWeight: 800,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px',
                  }}
                >
                  {s.num}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: '#6B6B6B', lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PROOF */}
      <section id="proof" style={{ maxWidth: 1040, margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 12 }}>
          {c.proofEyebrow}
        </div>
        <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1px', marginBottom: 12, lineHeight: 1.15 }}>{c.proofTitle}</h2>
        <p style={{ fontSize: 15, color: '#6B6B6B', marginBottom: 8, maxWidth: 640, lineHeight: 1.6 }}>
          {PROOF_VERIFIED_FIX_COUNT} production-verified fixes on {PROOF_SITE_HOST}.
        </p>
        <p style={{ fontSize: 15, color: '#6B6B6B', marginBottom: 36, maxWidth: 640, lineHeight: 1.6 }}>{PROOF_UI_COPY.proofNothingMore}</p>
        <div className="hp-proof-table">
          <div className="hp-proof-head">
            <div>{PROOF_UI_COPY.tableProblem}</div>
            <div>{PROOF_UI_COPY.tableChange}</div>
            <div>{PROOF_UI_COPY.tableVerified}</div>
          </div>
          {PROOF_EXAMPLES.map((ex) => (
            <div key={ex.prNumber} className="hp-proof-row">
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>{ex.problem}</div>
              <div style={{ fontSize: 13, color: '#6B6B6B', lineHeight: 1.5 }}>{ex.whatChanged}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                <VerifiedPill />
                <span style={{ fontSize: 12, color: '#9B9B9B' }}>{formatProofDate(ex.verifiedLiveOn)}</span>
                <a
                  href={`${PROOF_PR_BASE_URL}/${ex.prNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#FF6B2C', textDecoration: 'underline' }}
                >
                  PR #{ex.prNumber}
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ maxWidth: 1040, margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 12 }}>
            {c.pricingEyebrow}
          </div>
          <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1px', marginBottom: 10 }}>{c.pricingTitle}</h2>
          <p style={{ fontSize: 15, color: '#6B6B6B' }}>{c.pricingSubtitle}</p>
        </div>
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
                display: 'block',
                textAlign: 'center',
                padding: 10,
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
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
                    display: 'block',
                    textAlign: 'center',
                    padding: 10,
                    borderRadius: 7,
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: 'none',
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
      </section>

      {/* CTA */}
      <section style={{ background: '#0F0F0F', padding: '80px 48px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 40, fontWeight: 800, color: '#fff', letterSpacing: '-1.5px', marginBottom: 14 }}>{c.ctaTitle}</h2>
        <p style={{ fontSize: 16, color: '#6B6B6B', marginBottom: 32, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
          {c.ctaSubtitle}
        </p>
        <Link
          href="/signup"
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: '#fff',
            textDecoration: 'none',
            padding: '15px 36px',
            background: '#FF6B2C',
            borderRadius: 8,
          }}
        >
          {c.ctaButton}
        </Link>
      </section>

      <CompanyFooter />
    </div>
  )
}
