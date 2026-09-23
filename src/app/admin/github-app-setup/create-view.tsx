/**
 * Owner GitHub App setup: manual credential entry (primary) + optional
 * manifest fallback. Prints exact GitHub form values to paste.
 */

import Link from 'next/link'
import { CompanyFooter } from '@/components/CompanyFooter'
import {
  GITHUB_APP_MANUAL_FORM_VALUES,
  GITHUB_APP_URLS,
} from '@/lib/github-app/urls'

export type GithubAppSetupCreateViewProps = {
  error: string | null
  /** Non-secret fields preserved after a failed submit. */
  preservedAppId?: string | null
  preservedClientId?: string | null
}

export function GithubAppSetupCreateView(props: GithubAppSetupCreateViewProps) {
  const { error, preservedAppId, preservedClientId } = props
  const form = GITHUB_APP_MANUAL_FORM_VALUES

  return (
    <main className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F]">
      <div className="mx-auto max-w-xl px-6 py-16">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-[#6B6B6B]">
          Admin · GitHub App
        </p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">Register SEORANKO GitHub App</h1>
        <p className="text-[15px] text-[#333] mb-6">
          Create the App manually on GitHub (use a free name if SEORANKO is taken),
          paste the credentials below, then we verify{' '}
          <span className="font-mono text-sm">GET /app</span> with a JWT before
          storing anything. Secrets are encrypted at rest and never shown again.
        </p>

        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B6B6B] mb-3">
            Values for GitHub&apos;s New GitHub App form
          </h2>
          <dl className="space-y-3 text-sm text-[#333] border border-[#E5E5E0] rounded px-4 py-4 bg-white">
            <div>
              <dt className="text-[#6B6B6B]">Homepage URL</dt>
              <dd className="font-mono break-all">{form.homepageUrl}</dd>
            </div>
            <div>
              <dt className="text-[#6B6B6B]">Callback URL (User authorization callback URL)</dt>
              <dd className="font-mono break-all">{form.callbackUrl}</dd>
            </div>
            <div>
              <dt className="text-[#6B6B6B]">Setup URL</dt>
              <dd className="font-mono break-all">{form.setupUrl}</dd>
            </div>
            <div>
              <dt className="text-[#6B6B6B]">Webhook URL</dt>
              <dd className="font-mono break-all">{form.webhookUrl}</dd>
            </div>
            <div>
              <dt className="text-[#6B6B6B] mb-1">Repository permissions</dt>
              <dd>
                <ul className="list-disc pl-5 space-y-0.5 font-mono text-[13px]">
                  <li>Contents: {form.permissions.contents}</li>
                  <li>Pull requests: {form.permissions.pull_requests}</li>
                  <li>Commit statuses: {form.permissions.statuses}</li>
                  <li>Metadata: {form.permissions.metadata}</li>
                </ul>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-[#6B6B6B]">
            Also enable &quot;Request user authorization (OAuth) during installation&quot;
            and leave Webhook Active. Installation events are delivered automatically.
            After creating the App, generate a private key and copy App ID, Client ID,
            Client secret, and Webhook secret.
          </p>
        </section>

        {error && (
          <p className="mb-6 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 break-words">
            Setup failed: {error}
          </p>
        )}

        <section className="mb-12">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B6B6B] mb-3">
            Paste credentials
          </h2>
          <form
            method="post"
            action={GITHUB_APP_URLS.manualRegister}
            encType="multipart/form-data"
            className="space-y-4"
            autoComplete="off"
          >
            <label className="block text-sm">
              <span className="text-[#6B6B6B]">App ID</span>
              <input
                name="app_id"
                type="text"
                inputMode="numeric"
                required
                defaultValue={preservedAppId ?? ''}
                className="mt-1 w-full rounded border border-[#CCC] bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#6B6B6B]">Client ID</span>
              <input
                name="client_id"
                type="text"
                required
                defaultValue={preservedClientId ?? ''}
                className="mt-1 w-full rounded border border-[#CCC] bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#6B6B6B]">Client Secret</span>
              <input
                name="client_secret"
                type="password"
                required
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-[#CCC] bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#6B6B6B]">Webhook Secret</span>
              <input
                name="webhook_secret"
                type="password"
                required
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-[#CCC] bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#6B6B6B]">Private key (PEM)</span>
              <textarea
                name="private_key_pem"
                required
                rows={8}
                spellCheck={false}
                placeholder={'-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----'}
                className="mt-1 w-full rounded border border-[#CCC] bg-white px-3 py-2 font-mono text-xs leading-relaxed"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded bg-[#0F0F0F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#333]"
            >
              Verify and store
            </button>
          </form>
          <p className="mt-3 text-xs text-[#6B6B6B]">
            Submit calls <span className="font-mono">GET /app</span> with a fresh App JWT.
            If GitHub returns anything other than 200, nothing is stored; App ID and
            Client ID are kept so you only re-paste secrets.
          </p>
        </section>

        <section className="mb-12 border border-[#E5E5E0] rounded px-4 py-4 bg-white">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B6B6B] mb-2">
            Diagnose JWT (temporary)
          </h2>
          <p className="text-sm text-[#333] mb-3">
            Server-side only: builds the JWT, calls GET /app, returns claims, PEM
            format, GitHub status, raw body, and{' '}
            <span className="font-mono text-xs">x-github-request-id</span>. Never
            returns the key.
          </p>
          <form
            method="post"
            action={GITHUB_APP_URLS.jwtDiagnose}
            encType="multipart/form-data"
            className="space-y-3"
            autoComplete="off"
          >
            <label className="block text-sm">
              <span className="text-[#6B6B6B]">App ID</span>
              <input
                name="app_id"
                type="text"
                inputMode="numeric"
                required
                defaultValue={preservedAppId ?? ''}
                className="mt-1 w-full rounded border border-[#CCC] bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#6B6B6B]">Private key (PEM)</span>
              <textarea
                name="private_key_pem"
                required
                rows={6}
                spellCheck={false}
                className="mt-1 w-full rounded border border-[#CCC] bg-white px-3 py-2 font-mono text-xs leading-relaxed"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded border border-[#CCC] bg-[#FAFAF8] px-4 py-2 text-sm font-medium text-[#333] hover:bg-[#F0F0EC]"
            >
              Run JWT diagnose
            </button>
          </form>
        </section>

        <details className="mb-10 border-t border-[#E5E5E0] pt-6">
          <summary className="cursor-pointer text-sm text-[#6B6B6B] hover:text-[#0F0F0F]">
            Alternative: App Manifest one-click (secondary)
          </summary>
          <p className="mt-3 text-sm text-[#333] mb-3">
            Prefer manual entry — GitHub has returned unreachable Apps from the
            manifest flow. Use this only if you accept that risk.
          </p>
          <a
            href={GITHUB_APP_URLS.manifestStart}
            className="inline-flex items-center justify-center rounded border border-[#CCC] bg-white px-4 py-2 text-sm font-medium text-[#333] hover:bg-[#F0F0EC]"
          >
            Create via GitHub Manifest
          </a>
        </details>

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
