import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#fafafa]" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* ── Header ── */}
      <header className="border-b border-[#1f1f1f] sticky top-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#f59e0b] rounded-[8px] flex items-center justify-center shadow-lg shadow-amber-500/20">
              <span className="text-[#0a0a0a] font-extrabold text-sm leading-none">S</span>
            </div>
            <span className="text-xl font-bold tracking-tight">Seoranko</span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-[#6b7280] hover:text-[#fafafa] transition-colors text-sm font-medium">Features</a>
            <a href="#pricing" className="text-[#6b7280] hover:text-[#fafafa] transition-colors text-sm font-medium">Pricing</a>
            <Link href="/dashboard" className="text-[#6b7280] hover:text-[#fafafa] transition-colors text-sm font-medium">Login</Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="hidden sm:block text-sm text-[#6b7280] hover:text-[#fafafa] transition-colors font-medium">
              Login
            </Link>
            <Link
              href="/dashboard"
              className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-semibold text-sm px-4 py-2 rounded-[10px] transition-colors shadow-lg shadow-amber-500/20"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-7xl mx-auto px-6 pt-28 pb-24 text-center">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.06] mb-6 max-w-4xl mx-auto">
          AI-Powered SEO Content<br />
          <span className="text-[#f59e0b]">That Actually Ranks</span>
        </h1>

        <p className="text-lg md:text-xl text-[#6b7280] max-w-2xl mx-auto mb-10 leading-relaxed font-light">
          Find low competition keywords, cluster by intent, and generate EEAT-compliant articles in one workflow. Built for SEOs who care about results — not just output.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-bold text-base px-8 py-3.5 rounded-[10px] transition-all hover:scale-[1.02] shadow-lg shadow-amber-500/25 w-full sm:w-auto"
          >
            Start for Free →
          </Link>
          <a
            href="#features"
            className="border border-[#1f1f1f] hover:border-[#2a2a2a] text-[#6b7280] hover:text-[#fafafa] font-medium text-base px-8 py-3.5 rounded-[10px] transition-colors w-full sm:w-auto"
          >
            See How It Works
          </a>
        </div>

        <p className="text-xs text-[#6b7280] mt-5">No credit card required · Cancel anytime</p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-6 max-w-lg mx-auto mt-20 pt-16 border-t border-[#1f1f1f]">
          {[
            { value: "10k+", label: "Keywords/day" },
            { value: "94%", label: "Avg EEAT score" },
            { value: "3.2×", label: "Faster content" },
          ].map(({ value, label }) => (
            <div key={label}>
              <p className="text-3xl font-extrabold text-[#fafafa]">{value}</p>
              <p className="text-sm text-[#6b7280] mt-1">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything in one workflow</h2>
          <p className="text-[#6b7280] max-w-xl mx-auto text-sm">
            From seed keyword to published article — no tab-switching, no stitching tools together.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              icon: (
                <svg className="w-5 h-5 text-[#f59e0b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              ),
              title: "Keyword Research",
              desc: "Pull live search volume, KD, CPC and intent data. Filter UK, US or global markets instantly.",
              bullets: ["Real-time search volume", "Keyword difficulty (0–100)", "CPC & intent signals", "6-month trend data"],
            },
            {
              icon: (
                <svg className="w-5 h-5 text-[#f59e0b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              ),
              badge: "Popular",
              title: "AI Article Generator",
              desc: "Our AI writes long-form content that reads like an expert wrote it — varied structure, real examples, no filler phrases.",
              bullets: ["3-pass research + writing", "SEO title & meta included", "Readability & EEAT scores", "Keyword density control"],
            },
            {
              icon: (
                <svg className="w-5 h-5 text-[#f59e0b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              ),
              title: "EEAT Compliant",
              desc: "Every article is scored against Google's EEAT framework. Specific data, brand references, expertise signals — not vague fluff.",
              bullets: ["EEAT score per article", "Actionable improvements", "Content gap analysis", "Google HCU alignment"],
            },
          ].map(({ icon, badge, title, desc, bullets }) => (
            <div
              key={title}
              className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-8 hover:border-[#f59e0b]/40 transition-all group relative"
            >
              {badge && (
                <span className="absolute top-5 right-5 bg-[#f59e0b] text-[#0a0a0a] text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                  {badge}
                </span>
              )}
              <div className="w-10 h-10 bg-[#f59e0b]/10 rounded-[8px] flex items-center justify-center mb-6 group-hover:bg-[#f59e0b]/20 transition-colors">
                {icon}
              </div>
              <h3 className="text-lg font-bold mb-2">{title}</h3>
              <p className="text-[#6b7280] text-sm leading-relaxed mb-5">{desc}</p>
              <ul className="space-y-2">
                {bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-sm text-[#6b7280]">
                    <span className="w-1.5 h-1.5 bg-[#f59e0b] rounded-full flex-shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-12">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">From keyword to published article in 3 steps</h2>
            <p className="text-[#6b7280] text-sm">No SEO expertise required. The workflow handles it.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-6 left-1/3 right-1/3 h-px bg-gradient-to-r from-[#1f1f1f] via-[#f59e0b]/30 to-[#1f1f1f]" />
            {[
              { step: "01", title: "Research Keywords", desc: "Enter a seed topic. Get 11 keyword variations with volume, KD, CPC and intent — filtered by your target market." },
              { step: "02", title: "Cluster by Intent", desc: "One click groups keywords into informational, commercial and transactional clusters with opportunity scores." },
              { step: "03", title: "Generate Article", desc: "Pick a cluster, set word count and tone. The AI runs a research pass then writes a full EEAT article with scores." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center relative">
                <div className="w-12 h-12 bg-[#0a0a0a] border border-[#f59e0b]/40 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-[#f59e0b] font-bold text-sm">{step}</span>
                </div>
                <h3 className="font-bold mb-2">{title}</h3>
                <p className="text-[#6b7280] text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, transparent pricing</h2>
          <p className="text-[#6b7280] max-w-md mx-auto text-sm">All plans include keyword research, AI clustering, and EEAT scoring.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {[
            {
              name: "Free",
              price: "£0",
              priceSuffix: "/mo forever",
              tagline: "Try it, no card needed",
              features: ["1 keyword search/day", "200 word articles", "1 AI cluster/day", "EEAT scoring", "No credit card required"],
              highlighted: false,
              cta: "Start Free",
            },
            {
              name: "Starter",
              price: "£19",
              priceSuffix: "/mo",
              tagline: "Solo creators & bloggers",
              features: ["50 keyword searches/mo", "10 AI articles/mo", "UK & US markets", "EEAT scoring", "Email support"],
              highlighted: false,
              cta: "Get Started",
            },
            {
              name: "Pro",
              price: "£49",
              priceSuffix: "/mo",
              tagline: "Content teams & agencies",
              features: ["Unlimited keyword searches", "50 AI articles/mo", "Global market data", "AI keyword clustering", "Priority support", "API access"],
              highlighted: true,
              badge: "Most Popular",
              cta: "Get Started",
            },
            {
              name: "Agency",
              price: "£99",
              priceSuffix: "/mo",
              tagline: "Large teams & enterprises",
              features: ["Unlimited everything", "Unlimited AI articles", "White-label reports", "Custom EEAT templates", "Dedicated account manager", "SLA guarantee"],
              highlighted: false,
              cta: "Get Started",
            },
          ].map(({ name, price, priceSuffix, tagline, features, highlighted, badge, cta }) => (
            <div
              key={name}
              className={`bg-[#111111] rounded-[10px] p-8 relative ${
                highlighted ? "border border-[#f59e0b] shadow-lg shadow-amber-500/10" : "border border-[#1f1f1f]"
              }`}
            >
              {badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="bg-[#f59e0b] text-[#0a0a0a] text-[10px] font-bold px-4 py-1.5 rounded-full uppercase tracking-wider whitespace-nowrap">
                    {badge}
                  </span>
                </div>
              )}
              <h3 className="font-bold text-lg mb-1">{name}</h3>
              <p className="text-[#6b7280] text-xs mb-6">{tagline}</p>
              <div className="mb-8">
                <span className="text-4xl font-extrabold">{price}</span>
                <span className="text-[#6b7280] text-sm">{priceSuffix}</span>
              </div>
              <ul className="space-y-3 mb-8">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-[#6b7280]">
                    <svg className="w-4 h-4 text-[#f59e0b] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className={`block text-center font-semibold text-sm px-6 py-3 rounded-[10px] transition-colors ${
                  highlighted
                    ? "bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a]"
                    : "border border-[#2a2a2a] hover:border-[#f59e0b] text-[#fafafa]"
                }`}
              >
                {cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="max-w-7xl mx-auto px-6 pb-24">
        <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#f59e0b]/5 via-transparent to-transparent pointer-events-none" />
          <h2 className="text-3xl md:text-4xl font-bold mb-4 relative">Ready to rank higher?</h2>
          <p className="text-[#6b7280] max-w-md mx-auto mb-8 text-sm relative">
            Join SEOs using Seoranko to produce content that earns authority and drives real organic traffic.
          </p>
          <Link
            href="/dashboard"
            className="inline-block bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-bold text-base px-10 py-4 rounded-[10px] transition-all hover:scale-[1.02] shadow-lg shadow-amber-500/25 relative"
          >
            Get Started Free →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[#1f1f1f] max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#f59e0b] rounded-[6px] flex items-center justify-center">
              <span className="text-[#0a0a0a] font-bold text-xs">S</span>
            </div>
            <span className="font-semibold text-sm">Seoranko</span>
          </div>
          <p className="text-[#6b7280] text-xs">© {new Date().getFullYear()} Seoranko. All rights reserved.</p>
          <div className="flex gap-5 text-xs text-[#6b7280]">
            <a href="#" className="hover:text-[#fafafa] transition-colors">Privacy</a>
            <a href="#" className="hover:text-[#fafafa] transition-colors">Terms</a>
            <a href="#" className="hover:text-[#fafafa] transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
