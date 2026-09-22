/**
 * DRAFT — PENDING OWNER REVIEW
 *
 * Privacy policy for SEORANKO (operator: MINSO LTD).
 * Do not treat as final legal text until the owner confirms.
 */

import Link from 'next/link'
import { CompanyFooter } from '@/components/CompanyFooter'

export const metadata = {
  title: 'Privacy Policy (DRAFT) — Seoranko',
  robots: { index: false, follow: false },
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="mb-6 inline-block rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
          DRAFT — PENDING OWNER REVIEW
        </p>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#6B6B6B] mb-10">
          Last updated: 22 September 2026 · Operator / data controller:{' '}
          <strong>MINSO LTD</strong> (Companies House 17098778), registered in
          England and Wales.
        </p>

        <div className="prose prose-neutral max-w-none space-y-6 text-[15px] leading-relaxed text-[#333]">
          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">1. Who we are</h2>
            <p>
              SEORANKO is operated by <strong>MINSO LTD</strong> (company number{' '}
              <strong>17098778</strong>), a company registered in England and
              Wales. MINSO LTD is the <strong>data controller</strong> for
              personal data processed through seoranko.com and related services.
            </p>
            <p>
              Registered office:{' '}
              <em className="not-italic rounded bg-amber-50 px-1 border border-amber-200">
                [PLACEHOLDER — owner to fill registered office address]
              </em>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">2. Data we collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Account data</strong> — email address, authentication
                identifiers, and profile fields you provide at signup or in
                settings.
              </li>
              <li>
                <strong>Connected-site tokens</strong> — credentials for CMS /
                GitHub / similar connections you authorize. Repository and API
                tokens are <strong>encrypted at rest</strong> before storage.
              </li>
              <li>
                <strong>Crawl and audit results</strong> — URLs, HTTP signals,
                extracted page signals, findings, and related analysis produced
                when you run crawls or audits against sites you connect or
                nominate.
              </li>
              <li>
                <strong>Usage and billing metadata</strong> — plan status,
                invoices, and operational logs needed to run the service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">3. Why we process data</h2>
            <p>
              We process this data to provide the SEORANKO product (crawl,
              findings, fix workflows), secure your account, improve
              reliability, and meet legal obligations. Legal bases under UK GDPR
              include performance of a contract, legitimate interests (securing
              and operating the service), and consent where required.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">4. Third parties</h2>
            <p>We use processors / sub-processors including:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Supabase — authentication and database</li>
              <li>Vercel — hosting and edge delivery</li>
              <li>Stripe — payments (when billing is enabled)</li>
              <li>Google — Search Console / APIs you connect; analytics if enabled</li>
              <li>GitHub — repository connections you authorize</li>
              <li>Anthropic / other model providers — content analysis features</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">5. Retention</h2>
            <p>
              Account and connected-site data are retained while your account is
              active. Crawl results and findings are retained to power the
              product and may be deleted on account closure or upon verified
              request, subject to legal retention needs (e.g. billing records).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">6. Your UK GDPR rights</h2>
            <p>
              You may request access, rectification, erasure, restriction,
              portability, and objection to certain processing, and you may
              withdraw consent where processing is consent-based. You can
              complain to the UK Information Commissioner&apos;s Office (ICO).
              Contact us via the details in Settings or the address above once
              the registered office placeholder is completed.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">7. Security</h2>
            <p>
              Repo and site tokens are encrypted at rest. Access is limited to
              authenticated sessions and server-side service roles. No security
              measure is perfect; report suspected incidents promptly.
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
