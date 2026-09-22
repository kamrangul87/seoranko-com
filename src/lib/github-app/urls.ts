/**
 * Public URLs for the SEORANKO GitHub App (manifest + install callbacks).
 */

export const SEORANKO_PUBLIC_ORIGIN = 'https://www.seoranko.com'

export const GITHUB_APP_URLS = {
  homepage: SEORANKO_PUBLIC_ORIGIN,
  /** After Create GitHub App from manifest — exchange code here. */
  manifestRedirect: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/manifest/callback`,
  /** After user authorizes the app (request_oauth_on_install). */
  oauthCallback: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/callback`,
  /** After install — verify installation_id. */
  setup: `${SEORANKO_PUBLIC_ORIGIN}/api/github/app/setup`,
  webhook: `${SEORANKO_PUBLIC_ORIGIN}/api/webhooks/github`,
  adminSetupPage: `${SEORANKO_PUBLIC_ORIGIN}/admin/github-app-setup`,
} as const
