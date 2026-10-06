'use client';
import Link from 'next/link';
import { CompanyFooter } from '@/components/CompanyFooter';
import { SEORANKO_PLANS, SEORANKO_FREE_PLAN } from '@/lib/stripe/plans';
import { HOMEPAGE_COPY } from '@/lib/homepage-copy';
import {
  PROOF_EXAMPLES,
  PROOF_PR_BASE_URL,
  PROOF_SITE_HOST,
  PROOF_VERIFIED_FIX_COUNT,
} from '@/lib/proof-examples';

export default function LandingPage() {
  const c = HOMEPAGE_COPY
  return (
    <div style={{ fontFamily: "'Outfit', sans-serif", background: '#FAFAF8', color: '#0F0F0F', minHeight: '100vh' }}>

      {/* NAV */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 48px', height: '64px', background: '#fff', borderBottom: '1px solid #E8E8E4', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', background: '#FF6B2C', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '15px' }}>S</div>
          <span style={{ fontWeight: 700, fontSize: '18px', letterSpacing: '-0.3px' }}>SEORANKO</span>
        </div>
        <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
          {['Features', 'Pricing'].map(item => (
            <a key={item} href={`#${item.toLowerCase()}`} style={{ fontSize: '14px', color: '#6B6B6B', textDecoration: 'none' }}>{item}</a>
          ))}
          <Link href="/tools/index-diagnosis" style={{ fontSize: '14px', color: '#6B6B6B', textDecoration: 'none' }}>Free index check</Link>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Link href="/login" style={{ fontSize: '13px', color: '#333', textDecoration: 'none', padding: '7px 16px', border: '1px solid #E8E8E4', borderRadius: '7px', background: '#fff' }}>Log in</Link>
          <Link href="/signup" style={{ fontSize: '13px', fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '8px 18px', background: '#FF6B2C', borderRadius: '7px' }}>Start free →</Link>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ maxWidth: '860px', margin: '0 auto', padding: '88px 48px 64px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', background: '#FFF0E8', border: '1px solid rgba(255,107,44,0.25)', color: '#CC4A0F', fontSize: '12px', fontWeight: 600, padding: '5px 14px', borderRadius: '20px', marginBottom: '32px' }}>
          <div style={{ width: '6px', height: '6px', background: '#FF6B2C', borderRadius: '50%' }}></div>
          {c.badge}
        </div>
        <h1 style={{ fontSize: '46px', lineHeight: 1.15, fontWeight: 800, color: '#0F0F0F', letterSpacing: '-1.5px', marginBottom: '20px' }}>
          {c.heroTitle}
        </h1>
        <p style={{ fontSize: '18px', color: '#6B6B6B', lineHeight: 1.65, maxWidth: '580px', margin: '0 auto 40px' }}>
          {c.heroSubtitle}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
          <Link href="/signup" style={{ fontSize: '15px', fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '14px 32px', background: '#FF6B2C', borderRadius: '8px' }}>{c.heroCtaPrimary}</Link>
          <Link href="/tools/index-diagnosis" style={{ fontSize: '15px', color: '#333', textDecoration: 'none', padding: '13px 24px', background: '#fff', border: '1.5px solid #E8E8E4', borderRadius: '8px' }}>{c.heroCtaSecondary}</Link>
        </div>
        <p style={{ fontSize: '13px', color: '#9B9B9B' }}>{c.heroFootnote}</p>
      </section>

      {/* TRUST BAR */}
      <div style={{ borderTop: '1px solid #E8E8E4', borderBottom: '1px solid #E8E8E4', background: '#fff', padding: '14px 48px', display: 'flex', alignItems: 'center', gap: '40px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {c.trustBar.map(item => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#6B6B6B' }}>
            <span style={{ color: '#16A34A', fontWeight: 700 }}>✓</span> {item}
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <section id="features" style={{ maxWidth: '1040px', margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>{c.featuresEyebrow}</div>
        <h2 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '12px', lineHeight: 1.15 }}>{c.featuresTitle}</h2>
        <p style={{ fontSize: '16px', color: '#6B6B6B', maxWidth: '500px', lineHeight: 1.65, marginBottom: '48px' }}>{c.featuresSubtitle}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
          {c.features.map(f => (
            <div key={f.title} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ width: '38px', height: '38px', background: '#FFF0E8', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', marginBottom: '14px' }}>{f.icon}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '6px' }}>{f.title}</div>
              <div style={{ fontSize: '13px', color: '#6B6B6B', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <div style={{ background: '#fff', borderTop: '1px solid #E8E8E4', borderBottom: '1px solid #E8E8E4' }}>
        <div style={{ maxWidth: '1040px', margin: '0 auto', padding: '72px 48px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>{c.howItWorksEyebrow}</div>
          <h2 style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '48px' }}>{c.howItWorksTitle}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '28px' }}>
            {c.howItWorksSteps.map(s => (
              <div key={s.num} style={{ textAlign: 'center' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '50%', border: '2px solid #FF6B2C', color: '#FF6B2C', fontWeight: 800, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>{s.num}</div>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>{s.title}</div>
                <div style={{ fontSize: '13px', color: '#6B6B6B', lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PROOF */}
      <section id="proof" style={{ maxWidth: '1040px', margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>{c.proofEyebrow}</div>
        <h2 style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '12px', lineHeight: 1.15 }}>{c.proofTitle}</h2>
        <p style={{ fontSize: '15px', color: '#6B6B6B', marginBottom: '36px', maxWidth: '640px', lineHeight: 1.6 }}>
          {PROOF_VERIFIED_FIX_COUNT} production-verified fixes on {PROOF_SITE_HOST}. Each row is a change that was re-checked on the live site — nothing more.
        </p>
        <div style={{ display: 'grid', gap: '14px' }}>
          {PROOF_EXAMPLES.map((ex) => (
            <div key={ex.prNumber} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '20px 22px' }}>
              <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px', lineHeight: 1.45 }}>{ex.problem}</p>
              <p style={{ fontSize: '13px', color: '#6B6B6B', lineHeight: 1.55, marginBottom: '10px' }}>{ex.whatChanged}</p>
              <p style={{ fontSize: '12px', color: '#9B9B9B' }}>
                <a
                  href={`${PROOF_PR_BASE_URL}/${ex.prNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#FF6B2C', textDecoration: 'underline' }}
                >
                  PR #{ex.prNumber}
                </a>
                {' · '}verified live {ex.verifiedLiveOn}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ maxWidth: '1000px', margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>{c.pricingEyebrow}</div>
          <h2 style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '10px' }}>{c.pricingTitle}</h2>
          <p style={{ fontSize: '15px', color: '#6B6B6B' }}>{c.pricingSubtitle}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {[
            { ...SEORANKO_FREE_PLAN, featured: false },
            ...Object.values(SEORANKO_PLANS).map((p, i) => ({ ...p, featured: i === 1 })),
          ].map(p => (
            <div key={p.id} style={{ border: p.featured ? '2px solid #FF6B2C' : '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', background: '#fff', position: 'relative' }}>
              {p.featured && <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: '#FF6B2C', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '3px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>MOST POPULAR</div>}
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9B9B9B', letterSpacing: '1px', marginBottom: '6px' }}>{p.label.toUpperCase()}</div>
              <div style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '2px' }}>{p.priceDisplay.replace('/mo', '')}<span style={{ fontSize: '14px', fontWeight: 400, color: '#9B9B9B' }}>{p.priceDisplay.includes('/mo') ? '/mo' : ''}</span></div>
              <div style={{ fontSize: '12px', color: '#9B9B9B', marginBottom: '20px' }}>{p.tagline}</div>
              <div style={{ borderTop: '1px solid #E8E8E4', paddingTop: '16px', marginBottom: '20px' }}>
                {p.features.map(f => (
                  <div key={f} style={{ fontSize: '12px', color: '#444', padding: '4px 0', display: 'flex', gap: '7px' }}>
                    <span style={{ color: '#16A34A', fontWeight: 700, flexShrink: 0 }}>✓</span>{f}
                  </div>
                ))}
              </div>
              <Link href="/signup" style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, textDecoration: 'none', background: p.featured ? '#FF6B2C' : 'transparent', color: p.featured ? '#fff' : '#333', border: p.featured ? 'none' : '1.5px solid #E8E8E4' }}>
                {p.id === 'free' ? 'Start free' : 'Get started'}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: '#0F0F0F', padding: '80px 48px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '40px', fontWeight: 800, color: '#fff', letterSpacing: '-1.5px', marginBottom: '14px' }}>{c.ctaTitle}</h2>
        <p style={{ fontSize: '16px', color: '#6B6B6B', marginBottom: '32px', maxWidth: '520px', marginLeft: 'auto', marginRight: 'auto' }}>{c.ctaSubtitle}</p>
        <Link href="/signup" style={{ fontSize: '15px', fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '15px 36px', background: '#FF6B2C', borderRadius: '8px' }}>{c.ctaButton}</Link>
      </section>

      <CompanyFooter />

    </div>
  );
}
