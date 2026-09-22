/**
 * DRAFT — PENDING OWNER REVIEW
 *
 * Terms of service for SEORANKO (operator: MINSO LTD).
 * Do not treat as final legal text until the owner confirms.
 */

import Link from 'next/link'
import { CompanyFooter } from '@/components/CompanyFooter'

export const metadata = {
  title: 'Terms of Service (DRAFT) — Seoranko',
  robots: { index: false, follow: false },
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="mb-6 inline-block rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
          DRAFT — PENDING OWNER REVIEW
        </p>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-[#6B6B6B] mb-10">
          Last updated: 22 September 2026 · Operator:{' '}
          <strong>MINSO LTD</strong> (Companies House 17098778), England and
          Wales.
        </p>

        <div className="space-y-6 text-[15px] leading-relaxed text-[#333]">
          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">1. Agreement</h2>
            <p>
              By using SEORANKO you agree to these terms with{' '}
              <strong>MINSO LTD</strong> (company number 17098778). Registered
              office:{' '}
              <em className="not-italic rounded bg-amber-50 px-1 border border-amber-200">
                [PLACEHOLDER — owner to fill registered office address]
              </em>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">2. The service</h2>
            <p>
              SEORANKO provides SEO copilot tools: crawling, findings, and
              optional fix workflows against sites you own or are authorized to
              manage. You are responsible for the sites you connect and for
              complying with third-party terms (e.g. GitHub, CMS platforms).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">3. Acceptable use</h2>
            <p>
              You must not use the service to attack, scrape without
              authorization, or probe private networks. Crawls must target
              public sites you control or have permission to audit. Customer
              writes require approval gates as described in-product.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">4. Accounts and billing</h2>
            <p>
              You must keep credentials secure. Paid features (when enabled) are
              billed via Stripe under the plan you select. We may suspend abuse
              or non-payment.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">5. Disclaimer</h2>
            <p>
              The service is provided as-is. SEO outcomes are not guaranteed.
              Findings and suggested fixes are advisory; you remain responsible
              for publishing decisions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">6. Liability</h2>
            <p>
              To the fullest extent permitted by English law, MINSO LTD is not
              liable for indirect or consequential loss. Nothing in these terms
              limits liability for death or personal injury caused by
              negligence, fraud, or other liability that cannot be limited by
              law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">7. Governing law</h2>
            <p>
              These terms are governed by the laws of England and Wales. Courts
              of England and Wales have exclusive jurisdiction, subject to
              mandatory consumer protections.
            </p>
          </section>
        </div>

        <p className="mt-12 text-sm text-[#6B6B6B]">
          <Link href="/" className="text-[#FF6B2C] hover:underline">
            ← Back to home
          </Link>
        </p>
      </div>
      <CompanyFooter />
    </main>
  )
}
