/**
 * GitHub App manifest for one-click registration (launch 1.5).
 */

import { GITHUB_APP_URLS } from './urls'

/** Permissions: contents R/W, PRs R/W, commit statuses W, metadata R. */
export const SEORANKO_GITHUB_APP_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  statuses: 'write',
  metadata: 'read',
} as const

/**
 * Events that GitHub delivers to every App automatically and rejects in
 * `default_events` ("Default events unsupported: installation and
 * installation_repositories"). Keep this empty unless a subscribe-able
 * event is genuinely required. Webhook handlers still process installation
 * deliveries — they arrive regardless of this list.
 */
export const SEORANKO_GITHUB_APP_EVENTS: readonly string[] = []

/** Events GitHub refuses in App Manifest default_events. */
export const GITHUB_APP_MANIFEST_UNSUPPORTED_EVENTS = [
  'installation',
  'installation_repositories',
] as const

export function buildSeorankoGithubAppManifest(): Record<string, unknown> {
  return {
    name: 'SEORANKO',
    url: GITHUB_APP_URLS.homepage,
    description:
      'SEORANKO findings fix-flow: open PRs and report commit statuses on connected sites.',
    public: false,
    redirect_url: GITHUB_APP_URLS.manifestRedirect,
    callback_urls: [GITHUB_APP_URLS.oauthCallback],
    setup_url: GITHUB_APP_URLS.setup,
    setup_on_update: true,
    request_oauth_on_install: true,
    hook_attributes: {
      url: GITHUB_APP_URLS.webhook,
      active: true,
    },
    default_permissions: { ...SEORANKO_GITHUB_APP_PERMISSIONS },
    default_events: [...SEORANKO_GITHUB_APP_EVENTS],
  }
}
