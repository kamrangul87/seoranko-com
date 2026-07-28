'use client';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "'Outfit', sans-serif", background: '#FAFAF8', color: '#0F0F0F', minHeight: '100vh' }}>

      {/* NAV */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 48px', height: '64px', background: '#fff', borderBottom: '1px solid #E8E8E4', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', background: '#FF6B2C', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '15px' }}>S</div>
          <span style={{ fontWeight: 700, fontSize: '18px', letterSpacing: '-0.3px' }}>Seoranko</span>
        </div>
        <div style={{ display: 'flex', gap: '28px' }}>
          {['Features', 'Pricing', 'Blog'].map(item => (
            <a key={item} href={`#${item.toLowerCase()}`} style={{ fontSize: '14px', color: '#6B6B6B', textDecoration: 'none' }}>{item}</a>
          ))}
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
          Now with live fact verification on every article
        </div>
        <h1 style={{ fontSize: '54px', lineHeight: 1.1, fontWeight: 800, color: '#0F0F0F', letterSpacing: '-2px', marginBottom: '20px' }}>
          SEO content that<br /><span style={{ color: '#FF6B2C' }}>actually ranks</span>
        </h1>
        <p style={{ fontSize: '18px', color: '#6B6B6B', lineHeight: 1.65, maxWidth: '540px', margin: '0 auto 40px' }}>
          Research keywords, verify facts from live sources, and generate EEAT-compliant articles — all in one workflow. No hallucinations. No broken links.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '14px' }}>
          <Link href="/signup" style={{ fontSize: '15px', fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '14px 32px', background: '#FF6B2C', borderRadius: '8px' }}>Start for free →</Link>
          <a href="#features" style={{ fontSize: '15px', color: '#333', textDecoration: 'none', padding: '13px 24px', background: '#fff', border: '1.5px solid #E8E8E4', borderRadius: '8px' }}>See how it works</a>
        </div>
        <p style={{ fontSize: '13px', color: '#9B9B9B' }}>No credit card required · Cancel anytime</p>
      </section>

      {/* TRUST BAR */}
      <div style={{ borderTop: '1px solid #E8E8E4', borderBottom: '1px solid #E8E8E4', background: '#fff', padding: '14px 48px', display: 'flex', alignItems: 'center', gap: '40px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {['Live fact verification', 'EEAT compliant output', 'DataForSEO keyword data', '13+ country markets', 'No hallucinated facts'].map(item => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#6B6B6B' }}>
            <span style={{ color: '#16A34A', fontWeight: 700 }}>✓</span> {item}
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <section id="features" style={{ maxWidth: '1040px', margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>What&apos;s inside</div>
        <h2 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '12px', lineHeight: 1.15 }}>Everything from research<br />to ranked article</h2>
        <p style={{ fontSize: '16px', color: '#6B6B6B', maxWidth: '500px', lineHeight: 1.65, marginBottom: '48px' }}>No tab-switching between 5 tools. Seoranko handles the full pipeline.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
          {[
            { icon: '🔍', title: 'Keyword Research', desc: 'Live search volume, KD, CPC and intent data via DataForSEO. Filter by 13+ country markets including UK-specific data.', badge: null },
            { icon: '🧠', title: 'Discovery Engine', desc: 'Scan YouTube, Reddit, Google Trends and News to find content gaps before your competitors.', badge: null },
            { icon: '✅', title: 'Fact Verification', desc: 'Every article runs a live web search before writing. Unverified claims are blocked. Broken links removed automatically.', badge: 'NEW' },
            { icon: '✍️', title: 'AI Article Writer', desc: 'EEAT-compliant long-form articles with proper structure, UK sources, schema markup and readability scoring.', badge: null },
            { icon: '📊', title: 'EEAT Scoring', desc: "Every article scored against Google's EEAT framework. Get actionable improvements before you hit publish.", badge: null },
            { icon: '🎯', title: 'GEO + AEO Scoring', desc: 'Optimise for AI Overviews, ChatGPT citations, and Perplexity answers. The next frontier — coming soon.', badge: 'SOON' },
          ].map(f => (
            <div key={f.title} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ width: '38px', height: '38px', background: '#FFF0E8', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', marginBottom: '14px' }}>{f.icon}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {f.title}
                {f.badge && <span style={{ fontSize: '10px', fontWeight: 700, background: '#FF6B2C', color: '#fff', padding: '2px 8px', borderRadius: '4px' }}>{f.badge}</span>}
              </div>
              <div style={{ fontSize: '13px', color: '#6B6B6B', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <div style={{ background: '#fff', borderTop: '1px solid #E8E8E4', borderBottom: '1px solid #E8E8E4' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '72px 48px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>Workflow</div>
          <h2 style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '48px' }}>From keyword to published article in 3 steps</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px' }}>
            {[
              { num: '01', title: 'Research Keywords', desc: 'Enter a seed topic. Get keyword variations with volume, KD, CPC and intent filtered by your target market.' },
              { num: '02', title: 'Verify & Cluster', desc: 'One click groups keywords by intent. Facts are verified against live sources before any writing begins.' },
              { num: '03', title: 'Generate Article', desc: 'Pick a cluster. The AI runs a research pass, verifies every claim, then writes a full EEAT article with scores.' },
            ].map(s => (
              <div key={s.num} style={{ textAlign: 'center' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '50%', border: '2px solid #FF6B2C', color: '#FF6B2C', fontWeight: 800, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>{s.num}</div>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>{s.title}</div>
                <div style={{ fontSize: '13px', color: '#6B6B6B', lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRICING */}
      <section id="pricing" style={{ maxWidth: '1000px', margin: '0 auto', padding: '80px 48px' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#FF6B2C', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>Pricing</div>
          <h2 style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '10px' }}>Simple, honest pricing</h2>
          <p style={{ fontSize: '15px', color: '#6B6B6B' }}>All plans include keyword research, AI clustering, and EEAT scoring. Cancel anytime.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {[
            { plan: 'FREE', price: '£0', desc: 'Try it out', features: ['3 keyword searches/mo', '1 AI article/mo', 'EEAT scoring', 'No credit card'], featured: false },
            { plan: 'STARTER', price: '£29', desc: 'Solo creators', features: ['50 keyword searches/mo', '10 AI articles/mo', 'Fact verification', '13+ country markets'], featured: false },
            { plan: 'PRO', price: '£79', desc: 'Content teams', features: ['Unlimited keywords', '50 AI articles/mo', 'Discovery Engine', 'Priority support'], featured: true },
            { plan: 'AGENCY', price: '£149', desc: 'Large teams', features: ['Unlimited everything', 'Unlimited articles', 'White-label reports', 'API access'], featured: false },
          ].map(p => (
            <div key={p.plan} style={{ border: p.featured ? '2px solid #FF6B2C' : '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', background: '#fff', position: 'relative' }}>
              {p.featured && <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: '#FF6B2C', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '3px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>MOST POPULAR</div>}
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9B9B9B', letterSpacing: '1px', marginBottom: '6px' }}>{p.plan}</div>
              <div style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '2px' }}>{p.price}<span style={{ fontSize: '14px', fontWeight: 400, color: '#9B9B9B' }}>/mo</span></div>
              <div style={{ fontSize: '12px', color: '#9B9B9B', marginBottom: '20px' }}>{p.desc}</div>
              <div style={{ borderTop: '1px solid #E8E8E4', paddingTop: '16px', marginBottom: '20px' }}>
                {p.features.map(f => (
                  <div key={f} style={{ fontSize: '12px', color: '#444', padding: '4px 0', display: 'flex', gap: '7px' }}>
                    <span style={{ color: '#16A34A', fontWeight: 700, flexShrink: 0 }}>✓</span>{f}
                  </div>
                ))}
              </div>
              <Link href="/signup" style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, textDecoration: 'none', background: p.featured ? '#FF6B2C' : 'transparent', color: p.featured ? '#fff' : '#333', border: p.featured ? 'none' : '1.5px solid #E8E8E4' }}>
                {p.plan === 'FREE' ? 'Start free' : 'Get started'}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* TESTIMONIALS */}
      <div style={{ background: '#fff', borderTop: '1px solid #E8E8E4', borderBottom: '1px solid #E8E8E4', padding: '72px 48px' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px', marginBottom: '48px', textAlign: 'center' }}>
            {[['2,400+', 'Articles generated'], ['98%', 'Facts verified'], ['13', 'Country markets'], ['£0', 'To start today']].map(([num, label]) => (
              <div key={label}>
                <div style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-1.5px', color: '#0F0F0F' }}>{num}</div>
                <div style={{ fontSize: '13px', color: '#9B9B9B', marginTop: '4px' }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {[
              { text: '"The fact verification step alone saved us from publishing wrong DVSA rules. No other AI SEO tool does this."', name: 'Sarah M.', role: 'Content Lead, UK automotive blog' },
              { text: '"We replaced Frase and SurferSEO with Seoranko. The Discovery Engine finds opportunities we never would have spotted."', name: 'James T.', role: 'SEO Director, digital agency' },
              { text: '"Finally an AI tool that does not hallucinate government regulations. The live web search before writing is a game changer."', name: 'Priya K.', role: 'Freelance SEO consultant' },
            ].map(t => (
              <div key={t.name} style={{ background: '#FAFAF8', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '22px' }}>
                <div style={{ color: '#F59E0B', fontSize: '13px', marginBottom: '10px' }}>★★★★★</div>
                <div style={{ fontSize: '13px', color: '#444', lineHeight: 1.65, marginBottom: '16px' }}>{t.text}</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>{t.name}</div>
                <div style={{ fontSize: '11px', color: '#9B9B9B' }}>{t.role}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <section style={{ background: '#0F0F0F', padding: '80px 48px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '40px', fontWeight: 800, color: '#fff', letterSpacing: '-1.5px', marginBottom: '14px' }}>Start ranking in days,<br />not months.</h2>
        <p style={{ fontSize: '16px', color: '#6B6B6B', marginBottom: '32px' }}>Join content teams generating verified, EEAT-compliant articles at scale.</p>
        <Link href="/signup" style={{ fontSize: '15px', fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '15px 36px', background: '#FF6B2C', borderRadius: '8px' }}>Get started free →</Link>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#fff', borderTop: '1px solid #E8E8E4', padding: '28px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '15px', fontWeight: 700 }}>Seoranko</span>
        <span style={{ fontSize: '12px', color: '#9B9B9B' }}>© 2026 Seoranko. All rights reserved.</span>
        <div style={{ display: 'flex', gap: '20px' }}>
          {['Privacy', 'Terms', 'Contact', 'Blog'].map(l => (
            <a key={l} href="#" style={{ fontSize: '12px', color: '#9B9B9B', textDecoration: 'none' }}>{l}</a>
          ))}
        </div>
      </footer>

    </div>
  );
}
