/**
 * Public crawler identity page for SEORANKOBot.
 * Linked from the User-Agent contact URL (+https://seoranko.com/bot).
 */

import Link from 'next/link'
import { CompanyFooter } from '@/components/CompanyFooter'
import { SEORANKO_CRAWLER_USER_AGENT } from '@/lib/fix-strategies/findings-ui/crawl/crawler-identity'

export const metadata = {
  title: 'SEORANKOBot — Crawler info',
  description: 'What SEORANKOBot does and how to block it via robots.txt',
}

export default function BotPage() {
  return (
    <main className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-2">SEORANKOBot</h1>
        <p className="text-sm text-[#6B6B6B] mb-10">
          User-Agent: <code className="text-[#0F0F0F]">{SEORANKO_CRAWLER_USER_AGENT}</code>
        </p>

        <div className="space-y-6 text-[15px] leading-relaxed text-[#333]">
          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">What this crawler does</h2>
            <p>
              SEORANKOBot fetches publicly reachable pages on sites that a
              SEORANKO account holder has connected or nominated for audit. It
              collects HTTP signals and structural page data used for SEO
              findings. It does not index the open web for a search engine.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">How to block it</h2>
            <p>
              Add a <code>robots.txt</code> rule for this user-agent. Example:
            </p>
            <pre className="mt-3 overflow-x-auto rounded border border-[#E5E5E5] bg-white p-4 text-sm text-[#0F0F0F]">
{`User-agent: SEORANKOBot
Disallow: /`}
            </pre>
            <p className="mt-3">
              Path-specific Disallow / Allow directives are respected. We also
              honour the <code>*</code> group when no SEORANKOBot group is
              present.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#0F0F0F]">Contact</h2>
            <p>
              Operator: MINSO LTD (Companies House 17098778). See the{' '}
              <Link href="/privacy" className="text-[#FF6B2C] hover:underline">
                privacy policy
              </Link>{' '}
              for data-controller details.
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
