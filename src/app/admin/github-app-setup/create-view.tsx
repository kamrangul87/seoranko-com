/**
 * Presentational create-App form for /admin/github-app-setup.
 * Kept free of cookies()/redirect so it can be unit-tested safely.
 */

import Link from 'next/link'
import { CompanyFooter } from '@/components/CompanyFooter'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export function GithubAppSetupCreateView(props: {
  state: string
  manifestJson: string
  error: string | null
}) {
  const { state, manifestJson, error } = props
  return (
    <main className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F]">
      <div className="mx-auto max-w-xl px-6 py-16">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-[#6B6B6B]">
          Admin · GitHub App
        </p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">Create SEORANKO GitHub App</h1>
        <p className="text-[15px] text-[#333] mb-6">
          One-click registration via GitHub&apos;s App Manifest flow. Permissions:
          contents R/W, pull requests R/W, commit statuses W, metadata R. Events:
          installation, installation_repositories. Homepage{' '}
          <span className="font-mono text-sm">{GITHUB_APP_URLS.homepage}</span>.
        </p>
        <ul className="list-disc pl-5 text-sm text-[#333] space-y-1 mb-8">
          <li>Webhook: {GITHUB_APP_URLS.webhook}</li>
          <li>Setup URL: {GITHUB_APP_URLS.setup}</li>
          <li>OAuth callback: {GITHUB_APP_URLS.oauthCallback}</li>
        </ul>

        {error && (
          <p className="mb-6 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            Setup failed: {error}
          </p>
        )}

        <form
          action={`https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`}
          method="post"
        >
          <input type="hidden" name="manifest" value={manifestJson} />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded bg-[#0F0F0F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#333]"
          >
            Create GitHub App on GitHub
          </button>
        </form>
        <p className="mt-4 text-xs text-[#6B6B6B]">
          After you confirm on GitHub, credentials are exchanged server-side,
          encrypted, and stored with service-role access only. This page then
          disables itself.
        </p>
        <p className="mt-10 text-sm">
          <Link href="/dashboard" className="text-[#FF6B2C] hover:underline">
            ← Dashboard
          </Link>
        </p>
      </div>
      <CompanyFooter />
    </main>
  )
}
