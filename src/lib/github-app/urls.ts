/**
 * Public URLs for the SEORANKO GitHub App (manifest + install callbacks).
 */

export const SEORANKO_PUBLIC_ORIGIN = 'https://www.seoranko.com'

export const GITHUB_APP_URLS = {
  homepage: SEORANKO_PUBLIC_ORIGIN,
  /** After Create GitHub App from manifest — exchange code here. */
  manifestRedirect: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/manifest/callback`,
  /** Owner-only: mint state + auto-POST manifest to GitHub. */
  manifestStart: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/manifest/start`,
  /** Owner-only: paste credentials after creating the App manually on GitHub. */
  manualRegister: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/manual-register`,
  /** After user authorizes the app (request_oauth_on_install). */
  oauthCallback: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/callback`,
  /** After install — verify installation_id. */
  setup: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/setup`,
  webhook: `${SEORANKO_PUBLIC_ORIGIN}/api/webhooks/github`,
  adminSetupPage: `${SEORANKO_PUBLIC_ORIGIN}/admin/github-app-setup`,
} as const

/**
 * Exact values to paste into GitHub → Settings → Developer settings →
 * GitHub Apps → New GitHub App (manual create).
 */
export const GITHUB_APP_MANUAL_FORM_VALUES = {
  homepageUrl: GITHUB_APP_URLS.homepage,
  /** "Callback URL" / User authorization callback URL */
  callbackUrl: GITHUB_APP_URLS.oauthCallback,
  setupUrl: GITHUB_APP_URLS.setup,
  webhookUrl: GITHUB_APP_URLS.webhook,
  permissions: {
    contents: 'Read and write',
    pull_requests: 'Read and write',
    statuses: 'Read and write',
    metadata: 'Read-only',
  },
} as const
