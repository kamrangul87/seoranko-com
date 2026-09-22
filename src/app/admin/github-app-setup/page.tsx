/**
 * Owner-only one-click GitHub App registration via the Manifest flow.
 * Disabled once a product App already exists.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { buildSeorankoGithubAppManifest } from '@/lib/github-app/manifest'
import { getGithubAppPublicMeta } from '@/lib/github-app/store'
import { mintManifestStateCookie } from '@/lib/github-app/state'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'
import { CompanyFooter } from '@/components/CompanyFooter'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'GitHub App setup — Seoranko Admin',
  robots: { index: false, follow: false },
}

export default async function GithubAppSetupPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const master = await requireMasterUser()
  if (!master.ok) {
    if (master.status === 401) {
      redirect(`/login?next=${encodeURIComponent('/admin/github-app-setup')}`)
    }
    return (
      <main className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F] px-6 py-16">
        <div className="mx-auto max-w-xl">
          <h1 className="text-2xl font-bold mb-2">Forbidden</h1>
          <p className="text-[#6B6B6B]">Owner account only.</p>
        </div>
      </main>
    )
  }

  const existing = await getGithubAppPublicMeta()
  const q = searchParams || {}
  const created = q.created === '1'
  const already = q.already === '1'
  const error = typeof q.error === 'string' ? q.error : null

  if (existing) {
    return (
      <main className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F]">
        <div className="mx-auto max-w-xl px-6 py-16">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-[#6B6B6B]">
            Admin · GitHub App
          </p>
          <h1 className="text-3xl font-bold tracking-tight mb-3">Setup complete</h1>
          <p className="text-[15px] text-[#333] mb-6">
            A SEORANKO GitHub App is already registered. This page is disabled to
            prevent creating a second App or re-exposing credentials.
          </p>
          <dl className="space-y-2 text-sm text-[#333] mb-8">
            <div>
              <dt className="text-[#6B6B6B]">App ID</dt>
              <dd className="font-mono">{existing.appId}</dd>
            </div>
            <div>
              <dt className="text-[#6B6B6B]">Slug</dt>
              <dd className="font-mono">{existing.slug}</dd>
            </div>
            <div>
              <dt className="text-[#6B6B6B]">Client ID</dt>
              <dd className="font-mono">{existing.clientId}</dd>
            </div>
            {existing.htmlUrl ? (
              <div>
                <dt className="text-[#6B6B6B]">GitHub</dt>
                <dd>
                  <a
                    href={existing.htmlUrl}
                    className="text-[#FF6B2C] hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {existing.htmlUrl}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="text-sm text-[#6B6B6B]">
            Private key, client secret, and webhook secret are encrypted at rest
            (service-role only) and are never shown here.
          </p>
          {(created || already) && (
            <p className="mt-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              {created ? 'App created and credentials stored.' : 'App already existed.'}
            </p>
          )}
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

  const state = mintManifestStateCookie()
  const manifest = JSON.stringify(buildSeorankoGithubAppManifest())

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
          <input type="hidden" name="manifest" value={manifest} />
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
